'use strict';

/*
 * Jeu de données de démonstration (développement et recette).
 *
 *   DATA_DIR=./data-demo node scripts/seed-demo.js [dossier des gabarits SVG]
 *
 * Crée : un projet en collecte avec 6 contributions (photos de couleur,
 * vocaux factices, textes), un projet scellé et associé à un cadre NFC avec
 * composition complète, un projet expédié, plus 5 cadres NFC libres.
 * Affiche les liens utiles (organisateur, participation, cadre, aperçu).
 */

const path = require('path');
const sharp = require('sharp');
const config = require('../src/config');
const store = require('../src/store');
const media = require('../src/media');
const h = require('../routes/helpers');

const NAMES = ['Marc', 'Sophie', 'Léa', 'Antoine', 'Inès', 'Julien', 'Camille', 'Nadia', 'Hugo', 'Zoé', 'Paul', 'Manon'];
const COLORS = ['#dd7355', '#8fb3a3', '#e0b64a', '#6b8fb8', '#c78bb0', '#7a9e7e', '#d98c5f', '#9f86c0', '#5fa8a3', '#e2a1a1', '#b0a15f', '#6d8fa1'];
const TEXTS = [
  'Le jour où on a raté le train à Lyon et fini la soirée dans un karaoké… je ris encore.',
  'Ta façon de toujours voir le bon côté des choses, même quand tout part en vrille.',
  'Merci pour toutes ces heures à refaire le monde sur ton balcon.',
];

async function photo(color, i) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200"><rect width="900" height="1200" fill="${color}"/>
    <circle cx="450" cy="480" r="220" fill="#fff" opacity=".55"/><text x="450" y="1000" font-size="140" text-anchor="middle" fill="#fff" font-family="Arial">${i}</text></svg>`;
  const buf = await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
  return media.processPhoto(buf, { x: 0, y: 150, w: 900, h: 900 });
}

function audio() {
  return Buffer.concat([Buffer.from('1a45dfa3', 'hex'), require('crypto').randomBytes(6000)]);
}

async function contribute(project, i, kind) {
  const q = store.pickQuestion(project.id);
  const { contribution } = store.createContribution(project.id, { name: NAMES[i % NAMES.length], questionId: q && q.id, questionText: q && store.fillQuestion(q.text, project.recipient_name) });
  const ph = await photo(COLORS[i % COLORS.length], i + 1);
  store.addPhoto(project.id, { contributionId: contribution.id, source: 'contributor', ...ph });
  if (kind === 'text') store.setContributionText(contribution.id, TEXTS[i % TEXTS.length]);
  else {
    const a = await media.storeAudio(audio(), 'audio/webm', 20 + i * 5, 60);
    store.setContributionVoice(contribution.id, a);
  }
  store.completeContribution(contribution.id);
  return contribution;
}

(async () => {
  const dir = process.argv[2];
  if (dir) require('child_process').spawnSync('node', [path.join(__dirname, 'import-templates.js'), dir], { stdio: 'inherit', env: process.env });
  const templates = store.listTemplates(true);
  const formulas = store.listFormulas(true);

  // 1. Projet en collecte
  const a = store.createProject({ organizerEmail: 'clara@example.com', organizerName: 'Clara', formulaId: formulas[1].id, capacity: 25, shopify: { orderId: '9001', orderNumber: '#1001', customerEmail: 'clara@example.com' } });
  store.setupProject(a.project.id, { recipient_name: 'Chloé', occasion: 'Anniversaire', event_date: new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10) });
  for (let i = 0; i < 6; i++) await contribute(a.project, i, i % 3 === 0 ? 'text' : 'voice');

  // 2. Projet scellé avec cadre et composition
  const b = store.createProject({ organizerEmail: 'karim@example.com', organizerName: 'Karim', formulaId: formulas[0].id, capacity: 10, shopify: { orderId: '9002', orderNumber: '#1002', customerEmail: 'karim@example.com' } });
  store.setupProject(b.project.id, { recipient_name: 'Mamie Jeanne', occasion: '80 ans', event_date: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10) });
  for (let i = 0; i < 9; i++) await contribute(b.project, i + 3, i % 2 ? 'text' : 'voice');
  const tpl = templates.find((t) => t.slot_count === 12) || templates[0];
  if (tpl) {
    let photos = store.listPhotos(b.project.id);
    let k = 0;
    while (photos.length < tpl.slot_count) {
      const ph = await photo('#c9c0b0', 100 + k++);
      store.addPhoto(b.project.id, { source: 'organizer', ...ph });
      photos = store.listPhotos(b.project.id);
    }
    store.setComposition(b.project.id, tpl.id, photos.slice(0, tpl.slot_count).map((p, i) => ({ photoId: p.id, slot: i + 1 })), tpl.has_text ? 'Joyeux anniversaire Mamie' : null);
  }
  store.sealProject(b.project.id);
  const frames = store.createFrames(6, 'lot démo');
  store.linkFrame(frames[0].slug, b.project.id);

  // 3. Projet expédié
  const c = store.createProject({ organizerEmail: 'lucie@example.com', organizerName: 'Lucie', formulaId: formulas[0].id, capacity: 10 });
  store.setupProject(c.project.id, { recipient_name: 'Tom', occasion: 'Départ en retraite' });
  for (let i = 0; i < 3; i++) await contribute(c.project, i + 6, 'voice');
  store.setProjectStatus(c.project.id, 'sealed');
  store.setProjectStatus(c.project.id, 'shipped');
  store.linkFrame(frames[1].slug, c.project.id);

  console.log(`\nDonnées de démonstration créées dans ${config.DATA_DIR}\n`);
  console.log(`Organisateur (collecte)  : ${config.BASE_URL}/o/${a.token}`);
  console.log(`Participation (collecte) : ${config.BASE_URL}/p/${a.project.slug}`);
  console.log(`Organisateur (scellé)    : ${config.BASE_URL}/o/${b.token}`);
  console.log(`Cadre NFC (scellé)       : ${frames[0].url}`);
  console.log(`Aperçu (collecte)        : ${config.BASE_URL}/apercu/${a.project.slug}?p=${h.issuePreviewToken(a.project.id)}`);
  console.log(`Administration           : ${config.BASE_URL}/admin\n`);
})().catch((err) => { console.error(err); process.exit(1); });
