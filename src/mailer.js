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

// Quand un « collecteur » est actif (aperçu depuis l'administration), les
// messages sont rendus et empilés au lieu d'être envoyés.
let previewSink = null;

async function send({ projectId, type, to, subject, content }) {
  if (previewSink) {
    previewSink.push({ type, to, subject, html: layout(content), text: textVersion(content) });
    return true;
  }
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
// Emails métier : modèles avec variables, modifiables depuis l'administration
// ---------------------------------------------------------------------------

/*
 * Chaque email est un modèle { subject, title, intro, cta, outro } où les textes
 * contiennent des variables {prenom}, {destinataire}, {capacite}, … et où
 * **gras** devient <strong>. Les modèles par défaut ci-dessous peuvent être
 * remplacés par ceux enregistrés dans le réglage `email_texts` (admin,
 * Réglages > E-mails automatiques). Le lien du bouton n'est jamais éditable.
 */

function organizerUrl(token) {
  return `${config.BASE_URL}/o/${token}`;
}

const VARIABLES = {
  marque: 'Nom de marque (Réglages)',
  prenom: 'Prénom de l’organisateur (vide s’il est inconnu, l’espace qui précède est retiré)',
  destinataire: 'Prénom de la personne à qui le cadre est offert (« votre proche » si inconnu)',
  capacite: 'Nombre de proches de la formule',
  places_prises: 'Nombre de proches ayant déjà participé (alerte de capacité)',
  prix_place: 'Prix d’une place supplémentaire, ex. « 2,00 € » (alerte de capacité)',
  echeance: '« aujourd’hui », « demain » ou « dans N jours » (rappel avant l’événement)',
};

const LABELS = {
  project_access: 'Après la commande : accès au projet',
  access_link: 'Nouveau lien demandé par l’organisateur',
  capacity_alert: 'Alerte de capacité : proposer des places supplémentaires',
  closing_reminder: 'Rappel avant la date de l’événement',
  sealed: 'Confirmation de scellement',
  shipped: 'Confirmation d’expédition',
};

const DEFAULTS = {
  project_access: {
    subject: 'Votre cadre souvenir vous attend',
    title: 'Merci {prenom}, votre cadre souvenir est prêt à être créé',
    intro: 'Votre commande est confirmée. Il ne reste plus qu’à créer l’espace souvenir : le prénom de la personne à qui vous l’offrez, l’occasion, puis le lien à partager à ses proches.\n\nVotre formule permet de réunir jusqu’à **{capacite} proches**.',
    cta: 'Accéder à mon cadeau',
    outro: 'Ce lien est personnel : il donne accès au tableau de bord de votre projet. Ne le partagez pas, le lien de participation pour vos proches est différent et se trouve dans votre tableau de bord.',
  },
  access_link: {
    subject: 'Votre nouveau lien d’accès',
    title: 'Voici votre nouveau lien d’accès',
    intro: 'Vous avez demandé un nouveau lien pour le projet de **{destinataire}**. L’ancien lien ne fonctionne plus.',
    cta: 'Ouvrir mon tableau de bord',
    outro: 'Si vous n’êtes pas à l’origine de cette demande, ignorez simplement cet email.',
  },
  capacity_alert: {
    subject: 'Les places pour {destinataire} sont bientôt toutes prises',
    title: 'Votre cadre a du succès !',
    intro: '**{places_prises}** proches sur **{capacite}** ont déjà déposé un souvenir pour {destinataire}.\n\nSi d’autres personnes souhaitent participer, vous pouvez ajouter des places supplémentaires ({prix_place} par proche). Elles seront disponibles immédiatement après le paiement.',
    cta: 'Ajouter des places',
    outro: '',
  },
  closing_reminder: {
    subject: 'Le cadre de {destinataire} : pensez à le sceller',
    title: 'L’événement approche, c’est {echeance}',
    intro: 'Une fois les souvenirs réunis, choisissez le gabarit du cadre, sélectionnez les photos, puis scellez le projet : nous lançons alors la fabrication.\n\nComptez le délai de fabrication et de livraison pour recevoir le cadre à temps.',
    cta: 'Composer et sceller mon cadre',
    outro: '',
  },
  sealed: {
    subject: 'Votre cadre souvenir est scellé',
    title: 'C’est scellé, nous prenons le relais',
    intro: 'Le cadre de **{destinataire}** est maintenant clôturé. Nos équipes préparent le fichier d’impression et lancent la fabrication.\n\nVous recevrez un email à l’expédition. Les souvenirs, eux, ne seront révélés qu’au premier scan du cadre par son destinataire.',
    cta: 'Suivre mon projet',
    outro: '',
  },
  shipped: {
    subject: 'Votre cadre souvenir est en route',
    title: 'Le cadre est expédié',
    intro: 'Le cadre de **{destinataire}** vient de partir. À la réception, il suffira d’approcher un téléphone du cadre pour découvrir les souvenirs.',
    cta: 'Voir mon projet',
    outro: '',
  },
};

const FIELDS = ['subject', 'title', 'intro', 'cta', 'outro'];

function customTexts() {
  const all = store.getSetting('email_texts', {}) || {};
  return typeof all === 'object' && !Array.isArray(all) ? all : {};
}

/** Modèle effectif d'un email : personnalisé si enregistré, sinon celui par défaut. */
function templateFor(type) {
  const custom = customTexts()[type];
  const out = { ...DEFAULTS[type] };
  if (custom) for (const f of FIELDS) if (typeof custom[f] === 'string') out[f] = custom[f];
  return out;
}

/** Remplace les variables (valeurs échappées) puis **gras** ; retourne du HTML. */
function fill(text, vars, { html = true } = {}) {
  let out = String(text || '');
  out = out.replace(/ ?\{prenom\}/g, vars.prenom ? ` ${vars.prenom}` : '');
  out = out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
  if (!html) return out.replace(/\*\*/g, '');
  return escapeHtml(out).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function paragraphs(text, vars) {
  return String(text || '').split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean).map((t) => fill(t, vars).replace(/\n/g, '<br>'));
}

function baseVars(project) {
  return {
    marque: store.getSetting('brand_name', 'Ravive'),
    prenom: project.organizer_name || '',
    destinataire: project.recipient_name || 'votre proche',
    capacite: project.capacity,
  };
}

/** Construit et envoie un email métier à l'organisateur. */
function sendTemplate(type, project, vars, ctaUrl) {
  const t = templateFor(type);
  const v = { ...baseVars(project), ...vars };
  return send({
    projectId: project.id,
    type,
    to: project.organizer_email,
    subject: fill(t.subject, v, { html: false }).trim(),
    content: {
      title: fill(t.title, v, { html: false }).trim(),
      intro: paragraphs(t.intro, v),
      cta: t.cta ? fill(t.cta, v, { html: false }).trim() : '',
      ctaUrl,
      outro: paragraphs(t.outro, v),
    },
  });
}

/** Après achat : accès au projet (le lien privé n'est envoyé que par ce canal). */
function projectAccess(project, token) {
  return sendTemplate('project_access', project, {}, organizerUrl(token));
}

/** Nouveau lien demandé par l'organisateur (l'ancien est invalidé). */
function newAccessLink(project, token) {
  return sendTemplate('access_link', project, {}, organizerUrl(token));
}

/** Seuil de remplissage atteint : proposer des places supplémentaires. */
function capacityAlert(project, token, { used, extraUrl, extraPrice }) {
  const prix = extraPrice != null ? `${(extraPrice / 100).toFixed(2).replace('.', ',')} €` : '';
  return sendTemplate('capacity_alert', project, { places_prises: used, prix_place: prix }, extraUrl || organizerUrl(token));
}

/** Rappel avant la date de l'événement : penser à sceller. */
function closingReminder(project, token, daysLeft) {
  const echeance = daysLeft <= 0 ? 'aujourd’hui' : daysLeft === 1 ? 'demain' : `dans ${daysLeft} jours`;
  return sendTemplate('closing_reminder', project, { echeance }, organizerUrl(token));
}

/** Scellement confirmé : le projet part en fabrication. */
function sealedConfirmation(project, token) {
  return sendTemplate('sealed', project, {}, organizerUrl(token));
}

/** Expédition. */
function shippedConfirmation(project, token) {
  return sendTemplate('shipped', project, {}, organizerUrl(token));
}

/** Liste des modèles pour l'administration : défaut, personnalisé, variables. */
function listTemplates() {
  const custom = customTexts();
  return Object.keys(DEFAULTS).map((type) => ({ type, label: LABELS[type], default: DEFAULTS[type], custom: custom[type] || null }));
}

/** Enregistre (ou efface avec null) les textes personnalisés d'un email. */
function saveTemplate(type, texts) {
  if (!DEFAULTS[type]) return false;
  const all = customTexts();
  if (!texts) delete all[type];
  else {
    const clean = {};
    for (const f of FIELDS) clean[f] = String(texts[f] == null ? DEFAULTS[type][f] : texts[f]).slice(0, f === 'subject' || f === 'cta' ? 200 : 4000);
    if (!clean.subject.trim()) clean.subject = DEFAULTS[type].subject;
    if (!clean.cta.trim()) clean.cta = DEFAULTS[type].cta;
    all[type] = clean;
  }
  store.setSetting('email_texts', all);
  return true;
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

/** Rendu des emails automatiques avec un projet d'exemple, pour l'administration. */
async function previewAll() {
  const project = {
    id: 0, organizer_name: 'Lucie', organizer_email: 'lucie@exemple.fr', recipient_name: 'Mamie Jeanne', capacity: 25,
  };
  const token = 'exemple-de-lien-personnel';
  previewSink = [];
  try {
    await projectAccess(project, token);
    await newAccessLink(project, token);
    await capacityAlert(project, token, { used: 20, extraUrl: `${store.getSetting('shop_url', '') || config.BASE_URL}/`, extraPrice: Number(store.getSetting('extra_seat_price_cents', 200)) });
    await closingReminder(project, token, Number(store.getSetting('reminder_days_before', 3)));
    await sealedConfirmation(project, token);
    await shippedConfirmation(project, token);
    return previewSink.map((m) => ({ ...m, label: LABELS[m.type] || m.type }));
  } finally {
    previewSink = null;
  }
}

module.exports = {
  previewAll,
  listTemplates,
  saveTemplate,
  VARIABLES,
  projectAccess,
  newAccessLink,
  capacityAlert,
  closingReminder,
  sealedConfirmation,
  shippedConfirmation,
  testEmail,
};
