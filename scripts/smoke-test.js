'use strict';

/*
 * Test de bout en bout du produit cadres, sans navigateur :
 * démarre le serveur sur un port libre avec un dossier data temporaire, puis
 * déroule commande Shopify → organisateur → contributeurs → composition →
 * scellement → destinataire → export admin.
 *
 *   node scripts/smoke-test.js
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ravive-test-'));
const PORT = 3900 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = 'Bearer admin:secret';
const WEBHOOK_SECRET = 'whsec_test';

let failures = 0;
function check(cond, label) {
  if (cond) console.log(`  ✔ ${label}`);
  else { failures++; console.log(`  ✘ ${label}`); }
}

async function api(method, url, { body, headers = {}, raw = false } = {}) {
  const opts = { method, headers: { ...headers } };
  if (body !== undefined && !Buffer.isBuffer(body) && typeof body !== 'string') {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  } else if (body !== undefined) opts.body = body;
  const res = await fetch(BASE + url, opts);
  if (raw) return res;
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (_) { json = text; }
  return { status: res.status, body: json };
}

async function makeImage(color, size = 900) {
  const sharp = require('sharp');
  return sharp({ create: { width: size, height: Math.round(size * 1.4), channels: 3, background: color } }).jpeg().toBuffer();
}

function fakeAudio() {
  return Buffer.concat([Buffer.from('1a45dfa3', 'hex'), crypto.randomBytes(4000)]); // en-tête webm + bruit
}

(async () => {
  // Import des gabarits fournis (si présents) dans le data temporaire
  const templatesDir = process.argv[2];
  const env = {
    ...process.env, DATA_DIR: DATA, PORT: String(PORT), BASE_URL: BASE, ADMIN_USER: 'admin', ADMIN_TOKEN: 'secret',
    SHOPIFY_WEBHOOK_SECRET: WEBHOOK_SECRET, BREVO_API_KEY: '',
  };
  if (templatesDir) {
    const r = require('child_process').spawnSync('node', ['scripts/import-templates.js', templatesDir], { env, encoding: 'utf8' });
    process.stdout.write(r.stdout);
  }

  const server = spawn('node', ['server.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  server.stdout.on('data', (d) => { logs += d; });
  server.stderr.on('data', (d) => { logs += d; });
  for (let i = 0; i < 50; i++) {
    try { await fetch(BASE + '/healthz'); break; } catch (_) { await new Promise((r) => setTimeout(r, 100)); }
  }

  try {
    console.log('\n1. Webhook Shopify (commande payée, formule 25 proches)');
    const order = {
      id: 5551234, name: '#1001', email: 'Clara@example.com', financial_status: 'paid',
      customer: { first_name: 'Clara', email: 'clara@example.com' },
      line_items: [{ title: "Cadre jusqu'à 25 proches", quantity: 1, variant_id: 999, sku: 'RAVIVE-25' }],
    };
    const rawBody = Buffer.from(JSON.stringify(order));
    const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('base64');
    let r = await api('POST', '/api/shopify/webhook', { body: rawBody, headers: { 'Content-Type': 'application/json', 'X-Shopify-Hmac-Sha256': 'mauvais', 'X-Shopify-Topic': 'orders/paid', 'X-Shopify-Webhook-Id': 'evt-0' } });
    check(r.status === 401, 'signature invalide refusée');
    r = await api('POST', '/api/shopify/webhook', { body: rawBody, headers: { 'Content-Type': 'application/json', 'X-Shopify-Hmac-Sha256': hmac, 'X-Shopify-Topic': 'orders/paid', 'X-Shopify-Webhook-Id': 'evt-1' } });
    check(r.status === 200, 'webhook accepté');
    await new Promise((res) => setTimeout(res, 300));
    r = await api('POST', '/api/shopify/webhook', { body: rawBody, headers: { 'Content-Type': 'application/json', 'X-Shopify-Hmac-Sha256': hmac, 'X-Shopify-Topic': 'orders/paid', 'X-Shopify-Webhook-Id': 'evt-1' } });
    check(r.body.duplicate === true, 'webhook rejoué ignoré');

    r = await api('GET', '/api/admin/projects', { headers: { Authorization: ADMIN } });
    check(r.status === 200 && r.body.projects.length === 1, 'un projet créé par la commande');
    const proj = r.body.projects[0];
    check(proj.capacity === 25 && proj.status === 'preparing' && proj.organizer_email === 'clara@example.com', 'capacité 25, statut en préparation, email normalisé');
    const orgLink = logs.match(/\/o\/([A-Za-z0-9_-]{32})/);
    check(!!orgLink, 'email d’accès journalisé avec le lien organisateur');
    const token = orgLink[1];

    console.log('\n2. Organisateur : création du projet');
    r = await api('GET', `/api/o/${token}`);
    check(r.status === 200 && r.body.project.setupDone === false, 'tableau de bord accessible, projet à configurer');
    r = await api('GET', `/api/o/${'x'.repeat(32)}`);
    check(r.status === 404, 'jeton inconnu refusé');
    r = await api('POST', `/api/o/${token}/setup`, { body: { recipient_name: 'Chloé', occasion: 'anniversaire', event_date: '2026-12-24', organizer_name: 'Clara' } });
    check(r.status === 200 && r.body.project.status === 'collecting', 'projet configuré → collecte en cours');
    const slug = r.body.project.slug;
    const templates = r.body.templates;
    check(templates.length > 0, `${templates.length} gabarit(s) disponibles`);

    console.log('\n3. Contributeurs');
    r = await api('GET', `/api/p/${slug}`);
    check(r.status === 200 && r.body.open && r.body.recipientName === 'Chloé', 'page contributeur contextualisée');
    const names = ['Marc', 'Sophie', 'Léa'];
    const colors = ['#dd7355', '#8fb3a3', '#e0b64a'];
    for (let i = 0; i < names.length; i++) {
      r = await api('POST', `/api/p/${slug}/contributions`, { body: { name: names[i] } });
      check(r.status === 201 && r.body.token && r.body.question && r.body.question.text.includes('Chloé'), `${names[i]} : contribution créée avec question personnalisée`);
      const { id, token: ct } = r.body;
      const auth = { Authorization: `Bearer ${ct}` };
      r = await api('POST', `/api/p/${slug}/contributions/${id}/complete`, { headers: auth });
      check(r.status === 400 && r.body.error === 'memory_required', 'validation refusée sans souvenir');
      const img = await makeImage(colors[i]);
      r = await api('POST', `/api/p/${slug}/contributions/${id}/photo`, { body: img, headers: { ...auth, 'Content-Type': 'image/jpeg', 'X-Crop': JSON.stringify({ x: 0, y: 100, w: 900, h: 900 }) } });
      check(r.status === 200 && r.body.photoId && r.body.crop.w === 900, 'photo traitée avec recadrage');
      if (i === 0) {
        r = await api('POST', `/api/p/${slug}/contributions/${id}/text`, { body: { text: 'x'.repeat(1200) }, headers: auth });
        check(r.status === 400 && r.body.error === 'text_too_long', 'texte trop long refusé (1000 max)');
        r = await api('POST', `/api/p/${slug}/contributions/${id}/text`, { body: { text: 'Le jour où on a raté le train à Lyon…' }, headers: auth });
        check(r.status === 200, 'texte enregistré');
      } else {
        r = await api('POST', `/api/p/${slug}/contributions/${id}/audio?duration=42`, { body: fakeAudio(), headers: { ...auth, 'Content-Type': 'audio/webm' } });
        check(r.status === 200 && r.body.duration === 42, 'vocal enregistré');
      }
      r = await api('POST', `/api/p/${slug}/contributions/${id}/complete`, { headers: auth });
      check(r.status === 200 && r.body.used === i + 1, `contribution validée (${i + 1}/25)`);
      if (r.status !== 200) console.log('     →', r.status, JSON.stringify(r.body));
      r = await api('POST', `/api/p/${slug}/contributions/${id}/text`, { body: { text: 'trop tard' }, headers: auth });
      check(r.status === 423, 'contribution validée non modifiable');
    }

    console.log('\n4. Organisateur : photos, composition, scellement');
    r = await api('GET', `/api/o/${token}`);
    check(r.body.contributions.length === 3 && r.body.contributions.every((c) => c.text === undefined && c.audio === undefined), '3 contributions visibles sans leur contenu');
    check(r.body.photos.length === 3, '3 photos visibles');
    const t12 = templates.find((t) => t.slotCount === 12) || templates[0];
    r = await api('POST', `/api/o/${token}/seal`, { body: { confirm: true } });
    check(r.status === 400 && r.body.error === 'no_template', 'scellement refusé sans gabarit');
    // Ajout de photos organisateur pour compléter le gabarit
    const photoIds = (await api('GET', `/api/o/${token}`)).body.photos.map((p) => p.id);
    while (photoIds.length < t12.slotCount) {
      const img = await makeImage('#6b8fb8', 600);
      r = await api('POST', `/api/o/${token}/photos`, { body: img, headers: { 'Content-Type': 'image/jpeg' } });
      photoIds.push(r.body.id);
    }
    check(photoIds.length === t12.slotCount, `photos complétées par l’organisateur (${t12.slotCount})`);
    r = await api('PUT', `/api/o/${token}/composition`, { body: { templateId: t12.id, assignments: photoIds.slice(0, 5).map((photoId, i) => ({ photoId, slot: i + 1 })), frameText: 'Joyeux anniversaire' } });
    check(r.status === 200 && r.body.complete === false, 'composition partielle enregistrée');
    r = await api('POST', `/api/o/${token}/seal`, { body: { confirm: true } });
    check(r.status === 400 && r.body.error === 'composition_incomplete', 'scellement refusé : composition incomplète');
    r = await api('PUT', `/api/o/${token}/composition`, { body: { templateId: t12.id, assignments: photoIds.map((photoId, i) => ({ photoId, slot: i + 1 })), frameText: 'Joyeux anniversaire' } });
    check(r.status === 200 && r.body.complete === true, 'composition complète');
    r = await api('GET', `/api/o/${token}/preview.svg`, { raw: true });
    const svg = await r.text();
    check(r.status === 200 && (svg.match(/<image /g) || []).length === t12.slotCount, 'aperçu SVG avec toutes les photos');
    const previewUrl = (await api('GET', `/api/o/${token}`)).body.previewUrl;
    r = await api('GET', previewUrl.replace(BASE, ''), { raw: true });
    check(r.status === 200, 'aperçu destinataire accessible avant scellement');
    r = await api('POST', `/api/o/${token}/seal`, { body: { confirm: false } });
    check(r.status === 400, 'scellement refusé sans confirmation');
    r = await api('POST', `/api/o/${token}/seal`, { body: { confirm: true } });
    check(r.status === 200 && r.body.project.status === 'sealed', 'projet scellé');
    r = await api('POST', `/api/p/${slug}/contributions`, { body: { name: 'Retardataire' } });
    check(r.status === 423, 'collecte fermée après scellement');
    r = await api('POST', `/api/o/${token}/photos`, { body: await makeImage('#000', 300), headers: { 'Content-Type': 'image/jpeg' } });
    check(r.status === 423, 'plus de modification après scellement');

    console.log('\n5. Destinataire : cadre NFC, reveal, aperçu');
    r = await api('POST', '/api/admin/frames', { body: { count: 2, label: 'lot test' }, headers: { Authorization: ADMIN } });
    const frameSlug = r.body.frames[0].url.split('/f/')[1];
    r = await api('GET', `/f/${frameSlug}`, { raw: true });
    check(r.status === 200 && (await r.text()).includes('"notReady":true'), 'cadre non associé → pas encore prêt');
    r = await api('POST', `/api/admin/projects/${proj.id}/frame`, { body: { slug: `${BASE}/f/${frameSlug}` }, headers: { Authorization: ADMIN } });
    check(r.status === 200 && r.body.frame.slug === frameSlug, 'cadre associé au projet (URL collée)');
    r = await api('GET', `/api/f/${frameSlug}`);
    check(r.status === 200 && r.body.firstAccess === true && r.body.items.length === 3, 'premier accès : 3 souvenirs');
    check(r.body.items.filter((i) => i.inReveal).length === 3 && r.body.items.some((i) => i.text) && r.body.items.some((i) => i.audio), 'reveal : un par proche, texte et vocaux présents');
    const audioUrl = r.body.items.find((i) => i.audio).audio;
    r = await api('GET', audioUrl, { raw: true });
    check(r.status === 200 && r.headers.get('content-type').startsWith('audio/'), 'vocal servi au destinataire');
    r = await api('GET', audioUrl.replace(/audio\/\d+$/, 'audio/999999'), { raw: true });
    check(r.status === 404, 'vocal d’un autre projet inaccessible');
    r = await api('POST', `/api/f/${frameSlug}/reveal-done`);
    r = await api('GET', `/api/f/${frameSlug}`);
    check(r.body.firstAccess === false, 'accès suivant : reveal déjà vu');
    r = await api('GET', previewUrl.replace(BASE, '').replace('/apercu/', '/api/apercu/').replace('?p=', '/'));
    check(r.status === 200 && r.body.preview === true, 'aperçu signé fonctionne');
    r = await api('POST', `/api/admin/projects/${proj.id}/reset-reveal`, { headers: { Authorization: ADMIN } });
    r = await api('GET', `/api/f/${frameSlug}`);
    check(r.body.firstAccess === true, 'reveal réinitialisé par l’admin');

    console.log('\n6. Administration');
    r = await api('GET', `/api/admin/projects/${proj.id}`, { headers: { Authorization: ADMIN } });
    check(r.status === 200 && r.body.contributions.some((c) => c.text) && r.body.contributions.some((c) => c.audio), 'admin voit textes et vocaux');
    check(r.body.emails.some((e) => e.type === 'project_access') && r.body.emails.some((e) => e.type === 'sealed'), 'emails journalisés (accès, scellement)');
    r = await api('DELETE', `/api/admin/projects/${proj.id}/contributions/${r.body.contributions[0].id}`, { headers: { Authorization: ADMIN } });
    check(r.status === 200, 'contribution masquée');
    r = await api('GET', `/api/f/${frameSlug}`);
    check(r.body.items.length === 2, 'contribution masquée invisible pour le destinataire');
    r = await api('GET', `/api/admin/projects/${proj.id}/export.zip`, { headers: { Authorization: ADMIN }, raw: true });
    const zip = Buffer.from(await r.arrayBuffer());
    check(r.status === 200 && zip.length > 10000 && zip.subarray(0, 2).toString() === 'PK', `export ZIP (${Math.round(zip.length / 1024)} Ko)`);
    r = await api('POST', `/api/admin/projects/${proj.id}/status`, { body: { status: 'shipped' }, headers: { Authorization: ADMIN } });
    check(r.status === 200 && r.body.status === 'shipped' && r.body.emails.some((e) => e.type === 'shipped'), 'expédition + email');
    r = await api('GET', '/api/admin/overview', { headers: { Authorization: ADMIN } });
    check(r.status === 200 && r.body.stats.shipped === 1, 'vue d’ensemble');
    r = await api('GET', '/api/admin/overview');
    check(r.status === 401, 'admin protégé');

    console.log('\n7. Extension de capacité par Shopify');
    r = await api('PUT', '/api/admin/settings', { body: { extra_seat_shopify_sku: 'RAVIVE-EXTRA', shop_url: 'https://ravive.myshopify.com', extra_seat_shopify_variant_id: '777' }, headers: { Authorization: ADMIN } });
    const order2 = { id: 5551235, name: '#1002', email: 'clara@example.com', financial_status: 'paid', note_attributes: [{ name: 'ravive_projet', value: slug }], line_items: [{ title: 'Places supplémentaires', quantity: 5, variant_id: 777, sku: 'RAVIVE-EXTRA' }] };
    const raw2 = Buffer.from(JSON.stringify(order2));
    r = await api('POST', '/api/shopify/webhook', { body: raw2, headers: { 'Content-Type': 'application/json', 'X-Shopify-Hmac-Sha256': crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw2).digest('base64'), 'X-Shopify-Topic': 'orders/paid', 'X-Shopify-Webhook-Id': 'evt-2' } });
    await new Promise((res) => setTimeout(res, 300));
    r = await api('GET', `/api/admin/projects/${proj.id}`, { headers: { Authorization: ADMIN } });
    check(r.body.capacity === 30, 'capacité passée de 25 à 30');
    r = await api('GET', `/api/o/${token}`);
    check(r.body.extraSeatsUrl && r.body.extraSeatsUrl.includes(`ravive_projet]=${slug}`), 'lien « places supplémentaires » pré-rempli');

    console.log('\n8. Cartes NFC vocales (V1) toujours fonctionnelles');
    r = await api('POST', '/api/admin/cards', { body: { count: 2 }, headers: { Authorization: ADMIN } });
    check(r.status === 200 && r.body.cards.length === 2, 'lot de cartes généré');
    const card = r.body.cards[0];
    const cardSlug = card.url.split('/c/')[1];
    r = await api('GET', `/c/${cardSlug}`, { raw: true });
    check(r.status === 200 && (await r.text()).includes('"status":"pending"'), 'page carte servie');
    r = await api('POST', `/api/cards/${cardSlug}/activate`, { body: { code: card.code } });
    check(r.status === 200 && r.body.token, 'activation par code');
    r = await api('POST', `/api/cards/${cardSlug}/message?duration=12`, { body: fakeAudio(), headers: { Authorization: `Bearer ${r.body.token}`, 'Content-Type': 'audio/webm' } });
    check(r.status === 200, 'vocal scellé sur la carte');
    r = await api('GET', `/api/cards/${cardSlug}/audio`, { raw: true });
    check(r.status === 200, 'vocal lu par le destinataire');
    r = await api('GET', '/api/admin/cards', { headers: { Authorization: ADMIN } });
    check(r.body.cards.some((c) => c.slug === cardSlug && c.status === 'recorded'), 'carte enregistrée visible dans l’admin');

    console.log('\n9. Lien perdu');
    r = await api('POST', '/api/access', { body: { email: 'clara@example.com' } });
    check(r.status === 200, 'demande de nouveau lien acceptée');
    r = await api('GET', `/api/o/${token}`);
    check(r.status === 404, 'ancien lien invalidé');
    const links = logs.match(/\/o\/([A-Za-z0-9_-]{32})/g);
    r = await api('GET', `/api${links[links.length - 1]}`);
    check(r.status === 200, 'nouveau lien fonctionne');
  } catch (err) {
    failures++;
    console.error('\nErreur pendant le test :', err);
  } finally {
    server.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
  }
  if (failures) {
    console.log(`\n${failures} échec(s)\n--- journal serveur ---\n${logs.slice(-3000)}`);
    process.exit(1);
  }
  console.log('\nTout est vert.');
})();
