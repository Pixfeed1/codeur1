'use strict';

/*
 * Jeu de données de démonstration (développement et recette).
 *
 *   DATA_DIR=./data-demo node scripts/seed-demo.js [dossier des gabarits SVG] [--reset]
 *   --reset : supprime d'abord les projets de démonstration existants
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

// Vrai fichier audio (WAV 16 bits mono) : une petite mélodie, pour que les vocaux
// de démonstration se lisent réellement sur tous les téléphones.
const NOTES = [[523, 659, 784, 1047], [440, 554, 659, 880], [392, 494, 587, 784], [349, 440, 523, 698]];
function audio(variant, seconds) {
  const rate = 22050;
  const n = Math.round(rate * seconds);
  const pcm = Buffer.alloc(n * 2);
  const seq = NOTES[variant % NOTES.length];
  const noteLen = seconds / seq.length;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const k = Math.min(seq.length - 1, Math.floor(t / noteLen));
    const local = (t - k * noteLen) / noteLen; // 0..1 dans la note
    const env = Math.min(1, local * 12) * Math.pow(1 - local, 1.5);
    const f = seq[k];
    const v = (Math.sin(2 * Math.PI * f * t) * 0.6 + Math.sin(2 * Math.PI * f * 2 * t) * 0.25 + Math.sin(2 * Math.PI * f * 0.5 * t) * 0.15) * env * 0.35;
    pcm.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

const RELS = ['ami', 'famille', 'amour', 'collegue', 'autre'];
async function contribute(project, i, kind) {
  const { contribution } = store.createContribution(project.id, { name: NAMES[i % NAMES.length], relation: RELS[i % RELS.length] });
  const ph = await photo(COLORS[i % COLORS.length], i + 1);
  store.addPhoto(project.id, { contributionId: contribution.id, source: 'contributor', role: 'main', ...ph });
  if (i % 2 === 0) {
    const selfie = await photo(COLORS[(i + 3) % COLORS.length], '☺');
    store.addPhoto(project.id, { contributionId: contribution.id, source: 'contributor', role: 'selfie', ...selfie });
  }
  // Mot libre + une réponse à une question
  const qs = store.listQuestions(true);
  const q = qs[i % qs.length];
  const qtext = store.fillQuestion(q.text, project.recipient_name, project.recipient_gender);
  if (kind === 'text') {
    store.addMemory(project.id, contribution.id, { kind: 'text', isFree: true, text: TEXTS[i % TEXTS.length] });
    const a = await media.storeAudio(audio(i, 4 + (i % 3)), 'audio/wav', 4 + (i % 3), 60);
    store.addMemory(project.id, contribution.id, { kind: 'voice', audio: a, questionText: qtext, questionCategory: q.category, questionId: q.id });
  } else {
    const a = await media.storeAudio(audio(i, 4 + (i % 3)), 'audio/wav', 4 + (i % 3), 60);
    const star = store.addMemory(project.id, contribution.id, { kind: 'voice', isFree: true, audio: a });
    store.addMemory(project.id, contribution.id, { kind: 'text', text: TEXTS[(i + 1) % TEXTS.length], questionText: qtext, questionCategory: q.category, questionId: q.id });
    store.setStarMemory(contribution.id, star.id);
  }
  store.completeContribution(contribution.id);
  return contribution;
}

(async () => {
  const args = process.argv.slice(2);
  const reset = args.includes('--reset');
  const dir = args.find((a) => !a.startsWith('--'));
  if (dir) require('child_process').spawnSync('node', [path.join(__dirname, 'import-templates.js'), dir], { stdio: 'inherit', env: process.env });
  if (reset) {
    // Supprime les projets de démonstration précédents (organisateurs en @example.com)
    const old = store.listProjects({ limit: 1000 }).filter((p) => /@example\.com$/i.test(p.organizer_email || ''));
    old.forEach((p) => store.deleteProject(p.id));
    if (old.length) console.log(`${old.length} projet(s) de démonstration supprimé(s)`);
  }
  const templates = store.listTemplates(true);
  const formulas = store.listFormulas(true);

  // 1. Projet en collecte
  const a = store.createProject({ organizerEmail: 'clara@example.com', organizerName: 'Clara', formulaId: formulas[1].id, capacity: 25, shopify: { orderId: '9001', orderNumber: '#1001', customerEmail: 'clara@example.com' } });
  store.setupProject(a.project.id, { recipient_name: 'Chloé', recipient_gender: 'f', occasion: 'Anniversaire', event_date: new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10), deadline: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10) });
  for (let i = 0; i < 6; i++) await contribute(a.project, i, i % 3 === 0 ? 'text' : 'voice');

  // 2. Projet scellé avec cadre et composition
  const b = store.createProject({ organizerEmail: 'karim@example.com', organizerName: 'Karim', formulaId: formulas[0].id, capacity: 10, shopify: { orderId: '9002', orderNumber: '#1002', customerEmail: 'karim@example.com' } });
  store.setupProject(b.project.id, { recipient_name: 'Mamie Jeanne', recipient_gender: 'f', occasion: '80 ans', event_date: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10) });
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
  store.setupProject(c.project.id, { recipient_name: 'Tom', recipient_gender: 'm', occasion: 'Départ en retraite' });
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
