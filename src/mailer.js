'use strict';

/*
 * Emails transactionnels.
 *
 * Envoi via l'API Brevo (ex-Sendinblue, 300 emails/jour gratuits) quand
 * BREVO_API_KEY est défini. Sinon, l'email est journalisé (base + console) :
 * l'application reste utilisable en développement et en recette sans compte.
 *
 * Chaque envoi est tracé dans email_log (type, destinataire, statut).
 */

const config = require('./config');
const store = require('./store');

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function layout({ title, intro, cta, ctaUrl, outro }) {
  const brand = store.getSetting('brand_name', 'Ravive');
  const p = (t) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:#3d342d">${t}</p>`;
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#fdf8ec;font-family:Georgia,'Times New Roman',serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fdf8ec;padding:32px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#fff;border-radius:18px;padding:36px 32px">
<tr><td>
<p style="margin:0 0 24px;font-size:22px;font-weight:700;color:#dd7355;letter-spacing:.5px">${escapeHtml(brand.toLowerCase())}</p>
<h1 style="margin:0 0 20px;font-size:24px;line-height:1.3;color:#2b2420">${escapeHtml(title)}</h1>
${intro.map((t) => p(t)).join('')}
${cta ? `<p style="margin:28px 0"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#dd7355;color:#fff;text-decoration:none;font-weight:700;padding:14px 26px;border-radius:999px;font-size:16px">${escapeHtml(cta)}</a></p>
<p style="margin:0 0 16px;font-size:13px;color:#8b857d;word-break:break-all">Si le bouton ne fonctionne pas, copiez ce lien : ${escapeHtml(ctaUrl)}</p>` : ''}
${(outro || []).map((t) => p(t)).join('')}
<p style="margin:28px 0 0;font-size:13px;color:#8b857d">${escapeHtml(brand)} · Cet email est envoyé automatiquement, gardez-le précieusement.</p>
</td></tr></table>
</td></tr></table></body></html>`;
}

function textVersion({ title, intro, cta, ctaUrl, outro }) {
  return [title, '', ...intro.map((t) => t.replace(/<[^>]+>/g, '')), cta ? `\n${cta} : ${ctaUrl}\n` : '', ...(outro || [])].join('\n');
}

async function deliver({ to, subject, html, text }) {
  if (!config.BREVO_API_KEY) {
    console.log(`[mail] (non envoyé, BREVO_API_KEY absent) → ${to} : ${subject}\n${text}\n`);
    return { status: 'skipped' };
  }
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': config.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: config.MAIL_FROM_EMAIL, name: config.MAIL_FROM_NAME },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`brevo ${res.status} ${body.slice(0, 200)}`);
  }
  return { status: 'sent' };
}

async function send({ projectId, type, to, subject, content }) {
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    store.logEmail({ projectId, type, to: String(to || ''), subject, status: 'failed', error: 'invalid_recipient' });
    return false;
  }
  const html = layout(content);
  const text = textVersion(content);
  try {
    const r = await deliver({ to, subject, html, text });
    store.logEmail({ projectId, type, to, subject, status: r.status });
    return true;
  } catch (err) {
    console.error(`[mail] échec ${type} → ${to} : ${err.message}`);
    store.logEmail({ projectId, type, to, subject, status: 'failed', error: err.message });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Emails métier
// ---------------------------------------------------------------------------
function organizerUrl(token) {
  return `${config.BASE_URL}/o/${token}`;
}

/** Après achat : accès au projet (le lien privé n'est envoyé que par ce canal). */
function projectAccess(project, token) {
  const name = project.organizer_name ? ` ${project.organizer_name}` : '';
  return send({
    projectId: project.id,
    type: 'project_access',
    to: project.organizer_email,
    subject: 'Votre cadre souvenir vous attend',
    content: {
      title: `Merci${escapeHtml(name)}, votre cadre souvenir est prêt à être créé`,
      intro: [
        'Votre commande est confirmée. Il ne reste plus qu’à créer l’espace souvenir : le prénom de la personne à qui vous l’offrez, l’occasion, puis le lien à partager à ses proches.',
        `Votre formule permet de réunir jusqu’à <strong>${project.capacity} proches</strong>.`,
      ],
      cta: 'Accéder à mon cadeau',
      ctaUrl: organizerUrl(token),
      outro: [
        'Ce lien est personnel : il donne accès au tableau de bord de votre projet. Ne le partagez pas, le lien de participation pour vos proches est différent et se trouve dans votre tableau de bord.',
      ],
    },
  });
}

/** Nouveau lien demandé par l'organisateur (l'ancien est invalidé). */
function newAccessLink(project, token) {
  return send({
    projectId: project.id,
    type: 'access_link',
    to: project.organizer_email,
    subject: 'Votre nouveau lien d’accès',
    content: {
      title: 'Voici votre nouveau lien d’accès',
      intro: [
        `Vous avez demandé un nouveau lien pour le projet${project.recipient_name ? ` de <strong>${escapeHtml(project.recipient_name)}</strong>` : ''}. L’ancien lien ne fonctionne plus.`,
      ],
      cta: 'Ouvrir mon tableau de bord',
      ctaUrl: organizerUrl(token),
      outro: ['Si vous n’êtes pas à l’origine de cette demande, ignorez simplement cet email.'],
    },
  });
}

/** Seuil de remplissage atteint : proposer des places supplémentaires. */
function capacityAlert(project, token, { used, extraUrl, extraPrice }) {
  const price = extraPrice != null ? ` (${(extraPrice / 100).toFixed(2).replace('.', ',')} € par proche)` : '';
  return send({
    projectId: project.id,
    type: 'capacity_alert',
    to: project.organizer_email,
    subject: `Les places pour ${project.recipient_name || 'votre cadre'} sont bientôt toutes prises`,
    content: {
      title: 'Votre cadre a du succès !',
      intro: [
        `<strong>${used}</strong> proches sur <strong>${project.capacity}</strong> ont déjà déposé un souvenir${project.recipient_name ? ` pour ${escapeHtml(project.recipient_name)}` : ''}.`,
        `Si d’autres personnes souhaitent participer, vous pouvez ajouter des places supplémentaires${price}. Elles seront disponibles immédiatement après le paiement.`,
      ],
      cta: extraUrl ? 'Ajouter des places' : 'Voir mon tableau de bord',
      ctaUrl: extraUrl || organizerUrl(token),
    },
  });
}

/** Rappel avant la date de l'événement : penser à sceller. */
function closingReminder(project, token, daysLeft) {
  const when = daysLeft <= 0 ? 'aujourd’hui' : daysLeft === 1 ? 'demain' : `dans ${daysLeft} jours`;
  return send({
    projectId: project.id,
    type: 'closing_reminder',
    to: project.organizer_email,
    subject: `Le cadre de ${project.recipient_name || 'votre proche'} : pensez à le sceller`,
    content: {
      title: `L’événement approche, c’est ${when}`,
      intro: [
        'Une fois les souvenirs réunis, choisissez le gabarit du cadre, sélectionnez les photos, puis scellez le projet : nous lançons alors la fabrication.',
        'Comptez le délai de fabrication et de livraison pour recevoir le cadre à temps.',
      ],
      cta: 'Composer et sceller mon cadre',
      ctaUrl: organizerUrl(token),
    },
  });
}

/** Scellement confirmé : le projet part en fabrication. */
function sealedConfirmation(project, token) {
  return send({
    projectId: project.id,
    type: 'sealed',
    to: project.organizer_email,
    subject: 'Votre cadre souvenir est scellé',
    content: {
      title: 'C’est scellé, nous prenons le relais',
      intro: [
        `Le cadre${project.recipient_name ? ` de <strong>${escapeHtml(project.recipient_name)}</strong>` : ''} est maintenant clôturé. Nos équipes préparent le fichier d’impression et lancent la fabrication.`,
        'Vous recevrez un email à l’expédition. Les souvenirs, eux, ne seront révélés qu’au premier scan du cadre par son destinataire.',
      ],
      cta: 'Suivre mon projet',
      ctaUrl: organizerUrl(token),
    },
  });
}

/** Expédition. */
function shippedConfirmation(project, token) {
  return send({
    projectId: project.id,
    type: 'shipped',
    to: project.organizer_email,
    subject: 'Votre cadre souvenir est en route',
    content: {
      title: 'Le cadre est expédié',
      intro: [
        `Le cadre${project.recipient_name ? ` de <strong>${escapeHtml(project.recipient_name)}</strong>` : ''} vient de partir. À la réception, il suffira d’approcher un téléphone du cadre pour découvrir les souvenirs.`,
      ],
      cta: 'Voir mon projet',
      ctaUrl: organizerUrl(token),
    },
  });
}

/** Test depuis l'administration. */
function testEmail(to) {
  return send({
    type: 'test',
    to,
    subject: 'Test d’envoi Ravive',
    content: {
      title: 'L’envoi d’emails fonctionne',
      intro: ['Cet email a été envoyé depuis l’administration Ravive pour vérifier la configuration.'],
    },
  });
}

module.exports = {
  projectAccess,
  newAccessLink,
  capacityAlert,
  closingReminder,
  sealedConfirmation,
  shippedConfirmation,
  testEmail,
};
