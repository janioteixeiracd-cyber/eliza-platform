/**
 * Landing page pública — conteúdo/layout/CSS copiados literalmente do
 * pacote premium aprovado (eliza-premium-entrega/app/page.tsx), fonte
 * canônica. Única adaptação de conteúdo: CTAs que apontavam pra
 * `https://app.elizaclinic.com.br/` (fixo, sem sentido aqui já que esta
 * própria página roda nesse domínio) agora usam as rotas reais de
 * login/cadastro via react-router (`/login`, `/register`), sem recriar
 * nenhuma lógica de autenticação. Adaptações técnicas: `next/image` →
 * `<img>`, `next/link` → `Link` do react-router (só nos links que mudam
 * de rota; âncoras `#section` continuam `<a>` simples), CSS movido pra
 * publicLandingLegal.css com o wrapper `.eliza-premium-landing` (evita
 * vazar `body`/`a`/`button`/`footer`/`*` globais pro resto do app —
 * aprovado explicitamente pelo usuário).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BarChart3, BriefcaseBusiness, CalendarDays, Check, ChevronDown, CircleDollarSign, ClipboardPlus, Clock3, Crown, Headphones, HeartPulse, Menu, MessageCircleMore, ShieldCheck, Sparkles, UserRound, Users, X, Zap } from 'lucide-react';
import './publicLandingLegal.css';

const capabilities = [
  [CalendarDays, "01", "Agenda que pensa à frente", "Visualize a rotina, reduza lacunas e mantenha a equipe alinhada em cada atendimento.", "violet"],
  [ClipboardPlus, "02", "Clínico, claro e conectado", "Prontuário, planejamento e evolução reunidos para a história do paciente fazer sentido.", "cyan"],
  [CircleDollarSign, "03", "Gestão sem pontos cegos", "Transforme dados financeiros e operacionais em uma visão simples do que pede atenção.", "pink"],
  [MessageCircleMore, "04", "Uma presença na equipe", "A ELIZA observa o contexto, sinaliza pendências e ajuda sua clínica a decidir o próximo passo.", "gold"],
] as const;

const journey = [
  ["08:00", "Agenda organizada", "A equipe começa o dia sabendo prioridades e encaixes."],
  ["10:20", "Cuidado documentado", "Atendimento, planejamento e evolução permanecem conectados."],
  ["15:40", "Oportunidade percebida", "Pendências importantes aparecem antes de virarem esquecimento."],
  ["18:10", "Gestão compreendida", "O dia termina com uma leitura clara da clínica."],
];

const faqs = [
  ["A ELIZA é só um prontuário?", "Não. Ela reúne operação clínica, agenda, pacientes, financeiro e leitura de dados em uma experiência conectada — feita para apoiar a rotina inteira da clínica."],
  ["Preciso instalar algum programa?", "Não. A ELIZA funciona online e pode ser acessada pelo computador, tablet ou celular."],
  ["É difícil começar?", "O cadastro é rápido. A experiência foi desenhada para que profissionais e equipes entendam o essencial sem depender de treinamento complicado."],
  ["Meus dados ficam protegidos?", "A ELIZA foi construída com controle de acesso e práticas de segurança para proteger as informações da clínica e de seus pacientes."],
];

const models = [
  { Icon: UserRound, name: "ELIZA Assistente", tag: "ORGANIZAÇÃO", price: "R$ 197", founder: "R$ 97", text: "Para quem precisa colocar a rotina em ordem e ganhar tempo desde o primeiro dia.", items: ["Organiza agenda e compromissos", "Anota e centraliza informações", "Apoia recepção e rotina clínica"], featured: false, future: false },
  { Icon: Headphones, name: "ELIZA Secretária", tag: "RELACIONAMENTO", price: "R$ 397", founder: "R$ 197", text: "Para clínicas que querem uma presença ativa no relacionamento com cada paciente.", items: ["Conversa, confirma e acompanha", "Ajuda a reagendar horários", "Apoia a recuperação de pacientes"], featured: true, future: false },
  { Icon: BriefcaseBusiness, name: "ELIZA Gestora", tag: "GESTÃO", price: "R$ 797", founder: "R$ 397", text: "Para quem precisa compreender a operação e conduzir a equipe com mais clareza.", items: ["Analisa faturamento e metas", "Mostra perdas e oportunidades", "Acompanha equipe e resultados"], featured: false, future: false },
  { Icon: Crown, name: "ELIZA CEO", tag: "ESTRATÉGIA", price: "R$ 1.497–1.997", founder: "Lançamento futuro", text: "Para uma visão completa da clínica e participação real nas decisões estratégicas.", items: ["Prevê receitas e cenários", "Acompanha produção e conversão", "Conecta oportunidades, estoque e estratégia"], featured: false, future: true },
];

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <a href="#inicio" className="logo" aria-label="ELIZA — início">
      <img src="/eliza-wordmark.png" alt="ELIZA" />
      {!compact && <span>CLÍNICA INTELIGENTE</span>}
    </a>
  );
}

export default function PublicLandingView() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <main id="inicio" className="eliza-premium-landing">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <header className="nav-wrap">
        <nav className="nav shell" aria-label="Navegação principal">
          <Logo />
          <div className={`nav-links ${menuOpen ? "open" : ""}`}>
            <a href="#experiencia" onClick={() => setMenuOpen(false)}>A experiência</a>
            <a href="#plataforma" onClick={() => setMenuOpen(false)}>Plataforma</a>
            <a href="#modelos" onClick={() => setMenuOpen(false)}>Modelos</a>
            <a href="#como-funciona" onClick={() => setMenuOpen(false)}>Como funciona</a>
            <a href="#duvidas" onClick={() => setMenuOpen(false)}>Dúvidas</a>
            <Link className="mobile-login" to="/login">Entrar</Link>
          </div>
          <div className="nav-actions">
            <Link className="login-link" to="/login">Entrar</Link>
            <Link className="button button-small" to="/register">Começar agora <ArrowRight size={16} /></Link>
          </div>
          <button className="menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Abrir menu">{menuOpen ? <X /> : <Menu />}</button>
        </nav>
      </header>
      <section className="hero shell">
        <div className="hero-copy">
          <div className="eyebrow"><span className="pulse-dot" /> Inteligência que participa da rotina</div>
          <h1>Sua clínica não precisa de <em>mais um sistema.</em></h1>
          <p className="hero-statement">Precisa de uma inteligência que percebe, organiza e ajuda a transformar cada dia.</p>
          <p className="hero-sub">Conheça a ELIZA: uma plataforma criada para conectar cuidado clínico, equipe e gestão — sem tirar o humano do centro.</p>
          <div className="hero-actions">
            <Link className="button button-main" to="/register">Criar minha conta <ArrowRight size={19} /></Link>
            <a className="text-action" href="#experiencia"><span className="play"><ChevronDown size={18} /></span> Descobrir a ELIZA</a>
          </div>
          <div className="trust-row"><span><Check size={15} /> Cadastro em segundos</span><span><Check size={15} /> Sem cartão de crédito</span><span><ShieldCheck size={15} /> Acesso protegido</span></div>
        </div>
        <div className="hero-visual" aria-label="Visão da plataforma ELIZA">
          <div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="platform-glow" />
          <div className="dashboard-frame">
            <div className="browser-bar"><span /><span /><span /><small>app.elizaclinic.com.br</small></div>
            <img src="/eliza-dashboard.png" alt="Painel inteligente da plataforma ELIZA" width={1681} height={936} />
          </div>
          <div className="float-card float-a"><span className="mini-icon"><Zap size={16} /></span><div><small>ELIZA percebeu</small><strong>3 oportunidades hoje</strong></div></div>
          <div className="float-card float-b"><span className="mini-icon cyan"><BarChart3 size={16} /></span><div><small>Visão da clínica</small><strong>Decisões mais claras</strong></div></div>
          <div className="float-card float-c"><span className="live-dot" /><div><small>Agora</small><strong>Rotina conectada</strong></div></div>
        </div>
        <a href="#experiencia" className="scroll-cue" aria-label="Continuar"><span>EXPLORE</span><ChevronDown /></a>
      </section>
      <section className="belief shell" id="experiencia">
        <p className="section-kicker">UM NOVO JEITO DE CUIDAR DA CLÍNICA</p>
        <h2>Enquanto você cuida de pessoas,<br /><span>a ELIZA cuida do que não pode ser esquecido.</span></h2>
        <p>Menos energia tentando lembrar de tudo. Mais presença para atender, liderar e fazer sua clínica crescer.</p>
      </section>
      <section className="capabilities shell" id="plataforma">
        {capabilities.map(([Icon, number, title, text, accent]) => (
          <article className={`capability ${accent}`} key={number}>
            <div className="capability-top"><span className="cap-icon"><Icon /></span><span className="cap-number">{number}</span></div>
            <h3>{title}</h3><p>{text}</p><span className="cap-line" />
          </article>
        ))}
      </section>
      <section className="intelligence-section" id="como-funciona">
        <div className="shell intelligence-grid">
          <div className="intelligence-visual">
            <div className="mark-halo halo-a" /><div className="mark-halo halo-b" />
            <img src="/eliza-mark.png" alt="Símbolo da inteligência ELIZA" width={1254} height={1254} />
            <div className="signal signal-a"><Sparkles size={16} /> Contexto clínico</div>
            <div className="signal signal-b"><Users size={16} /> Equipe conectada</div>
            <div className="signal signal-c"><BarChart3 size={16} /> Gestão visível</div>
          </div>
          <div className="intelligence-copy">
            <p className="section-kicker">NÃO É UM BOT. É UMA NOVA CAMADA DE INTELIGÊNCIA.</p>
            <h2>Ela não espera você procurar.<br /><span>Ela ajuda você a perceber.</span></h2>
            <p>A ELIZA organiza sinais dispersos da rotina e os transforma em contexto útil. Assim, sua equipe enxerga o que aconteceu, o que precisa de atenção e qual pode ser o próximo passo.</p>
            <div className="principles">
              <div><span><Clock3 /></span><strong>Observa</strong><small>o ritmo da operação</small></div>
              <div><span><HeartPulse /></span><strong>Conecta</strong><small>cuidado e gestão</small></div>
              <div><span><Sparkles /></span><strong>Sugere</strong><small>com contexto</small></div>
            </div>
            <Link to="/register" className="line-link">Quero conhecer essa experiência <ArrowRight size={18} /></Link>
          </div>
        </div>
      </section>
      <section className="day-section shell">
        <div className="day-heading">
          <div><p className="section-kicker">DO PRIMEIRO HORÁRIO AO FECHAMENTO</p><h2>Um dia mais leve.<br /><span>Uma clínica mais consciente.</span></h2></div>
          <p>Não se trata de colocar tecnologia em cada canto. Trata-se de fazer a tecnologia desaparecer na rotina — e deixar apenas clareza.</p>
        </div>
        <div className="timeline">
          {journey.map(([time, title, text], index) => (
            <article key={time}>
              <div className="time"><span>{time}</span><i className={index === 2 ? "active" : ""} /></div>
              <div><small>0{index + 1}</small><h3>{title}</h3><p>{text}</p></div>
            </article>
          ))}
        </div>
      </section>
      <section className="proof-section">
        <div className="shell proof-grid">
          <div><p className="section-kicker">TUDO CONVERSA. TUDO FAZ SENTIDO.</p><h2>Uma só visão<br />para toda a clínica.</h2></div>
          <div className="proof-list">
            <span><CalendarDays /> Agenda</span><span><Users /> Pacientes</span><span><ClipboardPlus /> Prontuário</span>
            <span><CircleDollarSign /> Financeiro</span><span><BarChart3 /> Relatórios</span><span><Sparkles /> Inteligência ELIZA</span>
          </div>
        </div>
      </section>
      <section className="models-section" id="modelos">
        <div className="shell">
          <div className="models-heading">
            <div><p className="section-kicker">UMA ELIZA PARA CADA MOMENTO</p><h2>De quem executa a rotina<br /><span>a quem pensa o futuro.</span></h2></div>
            <p>Sua clínica escolhe o nível de participação que precisa hoje. Conforme cresce, a ELIZA cresce junto — assumindo novas responsabilidades sem perder todo o contexto construído.</p>
          </div>
          <div className="models-grid">
            {models.map(({ Icon, name, tag, price, founder, text, items, featured, future }) => (
              <article className={`model-card ${featured ? "featured" : ""} ${future ? "future" : ""}`} key={name}>
                {featured && <div className="popular">MAIS PROCURADA</div>}
                {future && <div className="popular future-label">EM BREVE</div>}
                <div className="model-top"><span className="model-icon"><Icon /></span><small>{tag}</small></div>
                <h3>{name}</h3><p>{text}</p>
                <ul>{items.map((item) => <li key={item}><Check />{item}</li>)}</ul>
                <div className="model-price"><small>Valor regular</small><strong>{price}<em>/mês</em></strong><span>{future ? founder : `Fundadores: ${founder}/mês`}</span></div>
                <Link to={future ? "/register" : "/register"} className="model-cta">{future ? "Quero ser avisado" : "Escolher este modelo"}<ArrowRight /></Link>
              </article>
            ))}
          </div>
          <div className="founder-note"><Sparkles /><div><strong>Condição para clínicas fundadoras</strong><span>Os valores especiais apresentados serão mantidos durante os primeiros 12 meses para as clínicas elegíveis.</span></div></div>
        </div>
      </section>
      <section className="faq shell" id="duvidas">
        <div className="faq-heading"><p className="section-kicker">PERGUNTAS FREQUENTES</p><h2>Clareza antes<br />de começar.</h2></div>
        <div className="faq-list">
          {faqs.map(([question, answer], index) => (
            <details key={question} open={index === 0}><summary>{question}<span>+</span></summary><p>{answer}</p></details>
          ))}
        </div>
      </section>
      <section className="final-cta shell">
        <div className="cta-stars">✦</div>
        <p className="section-kicker">SUA CLÍNICA JÁ TEM POTENCIAL.</p>
        <h2>Agora ela pode ter<br /><span>uma inteligência à altura.</span></h2>
        <p>Comece a construir uma rotina mais conectada, clara e humana.</p>
        <Link className="button button-main" to="/register">Conhecer a ELIZA agora <ArrowRight size={19} /></Link>
        <div className="trust-row centered"><span><Check size={15} /> Comece em segundos</span><span><Check size={15} /> Sem cartão de crédito</span></div>
      </section>
      <footer>
        <div className="shell footer-grid">
          <div><Logo compact /><p>Inteligência que participa.<br />Cuidado que continua humano.</p></div>
          <div><strong>Explore</strong><a href="#experiencia">A experiência</a><a href="#modelos">Modelos ELIZA</a><a href="#duvidas">Dúvidas</a></div>
          <div><strong>Institucional</strong><Link to="/company">A empresa</Link><Link to="/privacy">Privacidade</Link><Link to="/terms">Termos de uso</Link><Link to="/data-deletion">Exclusão de dados</Link></div>
          <div className="footer-sign"><span>ELIZA</span><small>Clínica Inteligente</small></div>
        </div>
        <div className="shell legal">
          <span>© 2026 ELIZA. Todos os direitos reservados.</span>
          <span>JANIO TEIXEIRA DA SILVA JUNIOR LTDA • CNPJ 37.421.772/0001-07</span>
        </div>
      </footer>
      <Link to="/register" className="sticky-cta">Começar agora <ArrowRight size={17} /></Link>
    </main>
  );
}
