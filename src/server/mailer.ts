import nodemailer from 'nodemailer';

/**
 * Custom-branded transactional e-mail via the founder's own Hostinger
 * mailbox — deliberately not Firebase Auth's default e-mail templates,
 * which can't be rebranded onto our own domain.
 *
 * eliza@elizaclinic.com.br is a Hostinger ALIAS of admin@elizaclinic.com.br
 * (confirmed in the Hostinger panel), not its own mailbox — aliases have no
 * SMTP password of their own. SMTP AUTH must use the real mailbox
 * (admin@), while the visible From: stays the branded alias, which
 * Hostinger allows since it belongs to the same account.
 *
 * HOSTINGER_SMTP_PASSWORD (the admin@ mailbox password) comes from Secret
 * Manager, same pattern as every other credential in server.ts
 * (process.env.X, populated by `gcloud run deploy --set-secrets`).
 */
let cachedTransporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (cachedTransporter) return cachedTransporter;
  const pass = process.env.HOSTINGER_SMTP_PASSWORD;
  if (!pass) throw new Error('HOSTINGER_SMTP_PASSWORD não configurada.');
  cachedTransporter = nodemailer.createTransport({
    host: 'smtp.hostinger.com',
    port: 465,
    secure: true,
    auth: { user: 'admin@elizaclinic.com.br', pass },
  });
  return cachedTransporter;
}

async function sendMail(to: string, subject: string, html: string): Promise<void> {
  await getTransporter().sendMail({
    from: '"ELIZA" <eliza@elizaclinic.com.br>',
    to,
    subject,
    html,
  });
}

function emailShell(bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#0a0612;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
      <tr><td align="center">
        <table width="480" cellpadding="0" cellspacing="0" style="background:#120c1f;border-radius:24px;padding:32px;">
          <tr><td>
            <div style="width:48px;height:48px;background:linear-gradient(135deg,#8b5cf6,#a855f7);border-radius:16px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:24px;text-align:center;line-height:48px;">E</div>
            ${bodyHtml}
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;
}

export async function sendVerificationEmail(to: string, name: string, verificationLink: string): Promise<void> {
  const body = `
    <h1 style="color:#fff;font-size:20px;margin:24px 0 8px;">Confirme seu e-mail</h1>
    <p style="color:#94a3b8;font-size:14px;line-height:1.6;">Olá, ${name}. Clique no botão abaixo para confirmar seu e-mail na ELIZA.</p>
    <a href="${verificationLink}" style="display:inline-block;margin-top:16px;padding:14px 24px;background:linear-gradient(135deg,#8b5cf6,#a855f7);color:#fff;text-decoration:none;border-radius:14px;font-weight:700;font-size:13px;">Confirmar e-mail</a>
    <p style="color:#64748b;font-size:11px;margin-top:24px;">Se você não criou essa conta, pode ignorar este e-mail.</p>
  `;
  await sendMail(to, 'Confirme seu e-mail — ELIZA', emailShell(body));
}

export async function sendPaymentConfirmationEmail(
  to: string,
  name: string,
  opts: { planLabel: string; priceCents: number; founderOffer: boolean }
): Promise<void> {
  const priceFormatted = (opts.priceCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const founderBlock = opts.founderOffer
    ? `<div style="margin-top:16px;padding:14px;background:rgba(139,92,246,0.12);border:1px solid rgba(139,92,246,0.3);border-radius:14px;">
        <p style="color:#c4b5fd;font-size:12px;font-weight:700;margin:0;">🎉 Você é uma das 150 clínicas fundadoras!</p>
        <p style="color:#94a3b8;font-size:12px;margin:6px 0 0;">Seu valor de lançamento fica preservado por 12 meses.</p>
      </div>`
    : '';
  const body = `
    <h1 style="color:#fff;font-size:20px;margin:24px 0 8px;">Pagamento confirmado</h1>
    <p style="color:#94a3b8;font-size:14px;line-height:1.6;">Olá, ${name}. Seu pagamento da modalidade <strong style="color:#fff;">${opts.planLabel}</strong> (${priceFormatted}/mês) foi confirmado.</p>
    ${founderBlock}
    <p style="color:#94a3b8;font-size:14px;margin-top:16px;">Volte à ELIZA para criar sua clínica agora.</p>
  `;
  await sendMail(to, 'Pagamento confirmado — ELIZA', emailShell(body));
}

export async function sendClinicCreatedEmail(to: string, ownerName: string, clinicName: string): Promise<void> {
  const body = `
    <h1 style="color:#fff;font-size:20px;margin:24px 0 8px;">Sua clínica foi cadastrada</h1>
    <p style="color:#94a3b8;font-size:14px;line-height:1.6;">Olá, ${ownerName}. A clínica <strong style="color:#fff;">${clinicName}</strong> acabou de ser cadastrada na ELIZA pela nossa equipe.</p>
    <p style="color:#94a3b8;font-size:14px;margin-top:16px;">Se você não esperava este e-mail, fale com a gente respondendo esta mensagem.</p>
  `;
  await sendMail(to, 'Sua clínica foi cadastrada — ELIZA', emailShell(body));
}

export async function sendPlanChangedEmail(to: string, ownerName: string, clinicName: string, planLabel: string): Promise<void> {
  const body = `
    <h1 style="color:#fff;font-size:20px;margin:24px 0 8px;">Modalidade contratada alterada</h1>
    <p style="color:#94a3b8;font-size:14px;line-height:1.6;">Olá, ${ownerName}. A modalidade da clínica <strong style="color:#fff;">${clinicName}</strong> foi alterada pela nossa equipe para <strong style="color:#fff;">${planLabel}</strong>.</p>
    <p style="color:#94a3b8;font-size:14px;margin-top:16px;">Se você não esperava essa mudança, fale com a gente respondendo esta mensagem.</p>
  `;
  await sendMail(to, 'Modalidade alterada — ELIZA', emailShell(body));
}

export async function sendAdminPasswordChangedEmail(to: string, ownerName: string, clinicName: string): Promise<void> {
  const body = `
    <h1 style="color:#fff;font-size:20px;margin:24px 0 8px;">Sua senha foi alterada</h1>
    <p style="color:#94a3b8;font-size:14px;line-height:1.6;">Olá, ${ownerName}. A senha de acesso da clínica <strong style="color:#fff;">${clinicName}</strong> foi redefinida pela nossa equipe de suporte.</p>
    <p style="color:#94a3b8;font-size:14px;margin-top:16px;">Se você não pediu essa alteração, fale com a gente imediatamente respondendo esta mensagem.</p>
  `;
  await sendMail(to, 'Sua senha foi alterada — ELIZA', emailShell(body));
}
