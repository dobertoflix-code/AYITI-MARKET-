// ════════════════════════════════════════════════════
// MAILER — Imèl tranzaksyonèl (Resend)
// ════════════════════════════════════════════════════
// Tout fonksyon isit yo pa janm bloke (throw) pwosesis prensipal la.
// Si Resend pa konfigire oswa rate echwe, nou jis log avètisman an
// epi kontinye — yon imèl ki pa voye pa dwe kraze yon vant/peman/mesaj.

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const MAIL_FROM = process.env.MAIL_FROM || 'Ayiti Market <no-reply@ayitimarket.ht>';
const FRONTEND_URL = (process.env.FRONTEND_URL || 'https://ayiti-market.com').replace(/\/$/, '');

if (!RESEND_API_KEY) {
  console.warn('⚠️  RESEND_API_KEY pa konfigire — imèl tranzaksyonèl dezaktive.');
}

// ── Anvlòp HTML komen pou tout imèl yo (branding minimal, mobile-friendly) ──
function wrapEmail(innerHtml, preheader = '') {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Ayiti Market</title>
</head>
<body style="margin:0;padding:0;background:#0E1116;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <span style="display:none;font-size:1px;color:#0E1116;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0E1116;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#161B22;border-radius:12px;overflow:hidden;">
        <tr>
          <td style="padding:24px 28px 0 28px;text-align:center;">
            <span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.02em;">Ayiti Market</span>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 28px 28px 28px;color:#C9D1D9;font-size:15px;line-height:1.6;">
            ${innerHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:16px 28px 24px 28px;border-top:1px solid #21262D;text-align:center;">
            <p style="margin:0;color:#6E7681;font-size:12px;">
              Ou resevwa imèl sa a paske ou gen yon kont sou
              <a href="${FRONTEND_URL}" style="color:#58A6FF;text-decoration:none;">Ayiti Market</a>.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function button(label, url) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;">
    <tr><td style="background:#2F81F7;border-radius:8px;">
      <a href="${url}" style="display:inline-block;padding:12px 24px;color:#ffffff;font-weight:600;font-size:14px;text-decoration:none;">${label}</a>
    </td></tr>
  </table>`;
}

// ── Voye yon imèl via Resend API ───────────────────
// Pa janm throw — retounen { sent: boolean } pou kontwòl apèlan an si li vle.
async function sendEmail({ to, subject, html }) {
  if (!RESEND_API_KEY) return { sent: false, reason: 'no_api_key' };
  if (!to) return { sent: false, reason: 'no_recipient' };

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from: MAIL_FROM, to, subject, html })
    });

    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      console.warn(`⚠️  Resend echwe (${r.status}) pou ${to}:`, errText);
      return { sent: false, reason: `http_${r.status}` };
    }
    return { sent: true };
  } catch (err) {
    console.warn('⚠️  Erè rezo Resend:', err.message);
    return { sent: false, reason: 'network_error' };
  }
}

// ════════════════════════════════════════════════════
// 1) IMÈL BYENVENI — apre yon moun fin kreye kont
// ════════════════════════════════════════════════════
async function sendWelcomeEmail({ to, fullName }) {
  const name = fullName?.trim() || 'Zanmi';
  const html = wrapEmail(`
    <h2 style="color:#ffffff;font-size:20px;margin:0 0 16px;">Byenveni, ${name} 👋</h2>
    <p style="margin:0 0 12px;">Kont ou sou <strong>Ayiti Market</strong> kreye avèk siksè.</p>
    <p style="margin:0 0 12px;">Ou kapab kounye a:</p>
    <ul style="margin:0 0 12px;padding-left:20px;color:#C9D1D9;">
      <li style="margin-bottom:6px;">Pibliye anons gratis pou vann sa ou genyen</li>
      <li style="margin-bottom:6px;">Chèche e kontakte vandè toupatou nan peyi a</li>
      <li style="margin-bottom:6px;">Chat dirèkteman ak achtè/vandè nan platfòm lan</li>
    </ul>
    ${button('Kòmanse pibliye yon anons', `${FRONTEND_URL}/account.html`)}
    <p style="margin:16px 0 0;color:#8B949E;font-size:13px;">Mèsi pou konfyans ou nan Ayiti Market 🇭🇹</p>
  `, 'Kont ou kreye — kòmanse vann sou Ayiti Market');

  return sendEmail({ to, subject: 'Byenveni sou Ayiti Market 🎉', html });
}

// ════════════════════════════════════════════════════
// 2) IMÈL VANT KONFIME — lè vandè make yon anons kòm vann
// ════════════════════════════════════════════════════
async function sendSoldEmail({ to, listingTitle, listingId }) {
  const html = wrapEmail(`
    <h2 style="color:#ffffff;font-size:20px;margin:0 0 16px;">Anons ou make kòm vann ✅</h2>
    <p style="margin:0 0 12px;">Anons <strong>"${listingTitle}"</strong> ou a kounye a make kòm <strong>vann</strong> sou Ayiti Market.</p>
    <p style="margin:0 0 12px;">Li pa parèt ankò nan rezilta rechèch piblik yo. Si ou te fè yon erè, ou ka mete l aktif ankò nan kont ou.</p>
    ${button('Jere anons mwen yo', `${FRONTEND_URL}/account.html`)}
  `, `Anons "${listingTitle}" make kòm vann`);

  return sendEmail({ to, subject: `Anons "${listingTitle}" make kòm vann ✅`, html });
}

// Notifye achtè enterese (moun ki te kontakte vandè a) yon anons li t ap gade vann deja
async function sendListingSoldNoticeToBuyer({ to, listingTitle }) {
  const html = wrapEmail(`
    <h2 style="color:#ffffff;font-size:20px;margin:0 0 16px;">Atik sa a vann deja</h2>
    <p style="margin:0 0 12px;">Anons <strong>"${listingTitle}"</strong> ou te enterese a, vandè a fenk make l kòm <strong>vann</strong>.</p>
    <p style="margin:0 0 12px;">Pa gen pwoblèm — gen anpil lòt bon zafè ki tann ou sou Ayiti Market.</p>
    ${button('Wè lòt anons', `${FRONTEND_URL}/index.html`)}
  `, `"${listingTitle}" vann deja`);

  return sendEmail({ to, subject: `"${listingTitle}" vann deja — men gen lòt zafè 👀`, html });
}

// ════════════════════════════════════════════════════
// 3) IMÈL KONFIMASYON PEMAN BOOST (MonCash auto / NatCash apre admin)
// ════════════════════════════════════════════════════
async function sendBoostConfirmedEmail({ to, listingTitle, tier, days, priceHtg, method }) {
  const methodLabel = method === 'moncash' ? 'MonCash' : (method === 'natcash' ? 'NatCash' : method);
  const html = wrapEmail(`
    <h2 style="color:#ffffff;font-size:20px;margin:0 0 16px;">Peman boost konfime 🚀</h2>
    <p style="margin:0 0 12px;">Peman ou pou bay anons <strong>"${listingTitle}"</strong> vedèt konfime.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0;background:#0E1116;border-radius:8px;">
      <tr><td style="padding:14px 16px;font-size:14px;color:#C9D1D9;">
        <div style="margin-bottom:6px;"><strong style="color:#fff;">Nivo vedèt:</strong> Tier ${tier}</div>
        <div style="margin-bottom:6px;"><strong style="color:#fff;">Dire:</strong> ${days} jou</div>
        <div style="margin-bottom:6px;"><strong style="color:#fff;">Pri:</strong> ${priceHtg} HTG</div>
        <div><strong style="color:#fff;">Metòd:</strong> ${methodLabel}</div>
      </tr>
    </table>
    <p style="margin:0 0 12px;">Anons ou kounye a vizib an premye nan rezilta rechèch yo pandan ${days} jou.</p>
    ${button('Wè anons mwen', `${FRONTEND_URL}/account.html`)}
  `, `Boost konfime pou "${listingTitle}"`);

  return sendEmail({ to, subject: `Peman boost konfime — "${listingTitle}" se vedèt kounye a 🚀`, html });
}

// ════════════════════════════════════════════════════
// 4) IMÈL NOUVO MESAJ — lè yon itilizatè resevwa yon mesaj chat
// ════════════════════════════════════════════════════
async function sendNewMessageEmail({ to, senderName, messagePreview, conversationId }) {
  const preview = (messagePreview || '📎 Fichye voye').slice(0, 140);
  const html = wrapEmail(`
    <h2 style="color:#ffffff;font-size:20px;margin:0 0 16px;">Nouvo mesaj sou Ayiti Market 💬</h2>
    <p style="margin:0 0 12px;"><strong>${senderName}</strong> voye yon mesaj ban ou:</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px;background:#0E1116;border-radius:8px;">
      <tr><td style="padding:14px 16px;font-size:14px;color:#C9D1D9;font-style:italic;">
        "${preview}"
      </td></tr>
    </table>
    ${button('Reponn kounye a', `${FRONTEND_URL}/messages.html${conversationId ? `?c=${conversationId}` : ''}`)}
  `, `${senderName}: ${preview}`);

  return sendEmail({ to, subject: `💬 ${senderName} voye yon mesaj ban ou`, html });
}

// ════════════════════════════════════════════════════
// 5) IMÈL KONFIMASYON PEMAN KONT BOUTIK PRO
// ════════════════════════════════════════════════════
async function sendShopProConfirmedEmail({ to, days, priceHtg, method, expiresAt }) {
  const methodLabel = method === 'moncash' ? 'MonCash' : (method === 'natcash' ? 'NatCash' : (method === 'referral' ? 'Rekonpans referans 🎁' : (method || 'Admin')));
  const expiresStr = expiresAt ? new Date(expiresAt).toLocaleDateString('fr-FR') : '';
  const html = wrapEmail(`
    <h2 style="color:#ffffff;font-size:20px;margin:0 0 16px;">Kont Boutik Pro aktive 👑</h2>
    <p style="margin:0 0 12px;">Peman ou pou <strong>Kont Boutik Pro</strong> konfime. Boutik ou kounye a gen tout avantaj Pro yo.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0;background:#0E1116;border-radius:8px;">
      <tr><td style="padding:14px 16px;font-size:14px;color:#C9D1D9;">
        <div style="margin-bottom:6px;"><strong style="color:#fff;">Dire:</strong> ${days} jou</div>
        <div style="margin-bottom:6px;"><strong style="color:#fff;">Pri:</strong> ${priceHtg} HTG</div>
        <div style="margin-bottom:6px;"><strong style="color:#fff;">Metòd:</strong> ${methodLabel}</div>
        ${expiresStr ? `<div><strong style="color:#fff;">Ekspire:</strong> ${expiresStr}</div>` : ''}
      </tr>
    </table>
    ${button('Wè boutik mwen', `${FRONTEND_URL}/account.html`)}
  `, 'Kont Boutik Pro aktive');

  return sendEmail({ to, subject: 'Kont Boutik Pro ou aktive 👑', html });
}

// ════════════════════════════════════════════════════
// 6) IMÈL ANONS — broadcast admin (mizajou, nouvèl, elatriye)
// ════════════════════════════════════════════════════
async function sendBroadcastEmail({ to, subject, bodyHtml, imageUrl }) {
  const imageBlock = imageUrl
    ? `<img src="${imageUrl}" alt="" style="width:100%;max-width:432px;border-radius:8px;display:block;margin:0 0 18px;">`
    : '';
  const html = wrapEmail(`
    ${imageBlock}
    <h2 style="color:#ffffff;font-size:20px;margin:0 0 16px;">${subject}</h2>
    <div style="font-size:15px;line-height:1.6;color:#C9D1D9;">${bodyHtml}</div>
    ${button('Vizite Ayiti Market', `${FRONTEND_URL}/index.html`)}
  `, subject);

  return sendEmail({ to, subject, html });
}

export {
  sendEmail,
  sendWelcomeEmail,
  sendSoldEmail,
  sendListingSoldNoticeToBuyer,
  sendBoostConfirmedEmail,
  sendShopProConfirmedEmail,
  sendNewMessageEmail,
  sendBroadcastEmail,
};
