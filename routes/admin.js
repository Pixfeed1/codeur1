'use strict';

/*
 * Administration Ravive (produit cadres). Authentification : même mécanisme
 * que l'admin cartes (Bearer "identifiant:motdepasse", ADMIN_USER/ADMIN_TOKEN).
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const { ZipArchive } = require('archiver');
const config = require('../src/config');
const store = require('../src/store');
const media = require('../src/media');
const mailer = require('../src/mailer');
const shopify = require('../src/shopify');
const jobs = require('../src/jobs');
const { parseTemplate, sanitizeSvg, renderPreview } = require('../src/templates');
const h = require('./helpers');

const router = express.Router();
const json = express.json({ limit: '256kb' });

function projectOr404(req, res) {
  const p = store.getProject(Number(req.params.id));
  if (!p) {
    res.status(404).json({ error: 'not_found' });
    return null;
  }
  return p;
}

function adminMedia(ph) {
  return {
    id: ph.id,
    source: ph.source,
    contributionId: ph.contribution_id,
    contributorName: ph.contributor_name || null,
    slot: ph.slot,
    deletedAt: ph.deleted_at,
    thumb: `/api/admin/media/photo/${ph.id}/thumb`,
    square: `/api/admin/media/photo/${ph.id}/square`,
    original: `/api/admin/media/photo/${ph.id}/original`,
    width: ph.width,
    height: ph.height,
    crop: ph.crop ? JSON.parse(ph.crop) : null,
    createdAt: ph.created_at,
  };
}

function projectDetail(p) {
  const frame = store.getFrameByProject(p.id);
  const template = p.template_id ? store.getTemplate(p.template_id) : null;
  const contributions = store.listContributions(p.id, { includeDeleted: true, doneOnly: false }).map((c) => ({
    id: c.id,
    name: c.contributor_name,
    relation: c.relation,
    status: c.status,
    photoId: c.photo_id,
    thumb: c.photo_id ? `/api/admin/media/photo/${c.photo_id}/thumb` : null,
    selfie: c.selfie_thumb ? `/api/admin/media/selfie/${c.id}` : null,
    star: c.star_memory_id,
    memories: store.listMemories(c.id, { includeDeleted: true }).map((m) => ({
      id: m.id,
      kind: m.kind,
      free: !!m.is_free,
      question: m.question_text,
      category: m.question_category,
      text: m.text_body,
      audio: m.audio_file ? `/api/admin/media/audio/${m.id}` : null,
      duration: m.audio_duration_s,
      photoId: m.photo_id,
      photo: m.photo_id ? `/api/admin/media/photo/${m.photo_id}/square` : null,
      deletedAt: m.deleted_at,
    })),
    createdAt: c.created_at,
    completedAt: c.completed_at,
    deletedAt: c.deleted_at,
  }));
  const photos = store.listPhotos(p.id, { includeDeleted: true, doneOnly: false }).map(adminMedia);
  return {
    ...p,
    organizer_token_hash: undefined,
    organizer_token_enc: undefined,
    formula: p.formula_id ? store.getFormula(p.formula_id) : null,
    template: template ? { id: template.id, name: template.name, slotCount: template.slot_count, hasText: template.has_text } : null,
    frame: frame ? { slug: frame.slug, url: `${config.BASE_URL}/f/${frame.slug}`, linkedAt: frame.linked_at } : null,
    used: store.countDone(p.id),
    participationUrl: `${config.BASE_URL}/p/${p.slug}`,
    previewUrl: `${config.BASE_URL}/apercu/${p.slug}?p=${h.issuePreviewToken(p.id)}`,
    contributions,
    photos,
    emails: store.listEmails(p.id),
  };
}

// ---------------------------------------------------------------------------
// Vue d'ensemble et projets
// ---------------------------------------------------------------------------
router.get('/overview', (req, res) => {
  res.json({
    baseUrl: config.BASE_URL,
    stats: store.projectStats(),
    templates: store.listTemplates().length,
    questions: store.listQuestions(true).length,
    unlinkedFrames: store.listFrames({ unlinkedOnly: true, limit: 10000 }).length,
    mail: config.BREVO_API_KEY ? 'brevo' : 'console',
    shopifyWebhook: !!config.SHOPIFY_WEBHOOK_SECRET,
    ffmpeg: media.ffmpegAvailable(),
  });
});

router.get('/projects', (req, res) => {
  res.json({ projects: store.listProjects({ status: req.query.status, q: req.query.q ? String(req.query.q).trim() : '' }) });
});

router.get('/projects/:id', (req, res) => {
  const p = projectOr404(req, res);
  if (p) res.json(projectDetail(p));
});

router.patch('/projects/:id', json, (req, res) => {
  const p = projectOr404(req, res);
  if (!p) return;
  try {
    store.updateProjectAdmin(p.id, req.body || {});
    res.json(projectDetail(store.getProject(p.id)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/projects/:id/status', json, async (req, res) => {
  const p = projectOr404(req, res);
  if (!p) return;
  try {
    const status = String((req.body && req.body.status) || '');
    const updated = store.setProjectStatus(p.id, status);
    if (status === 'shipped' && p.status !== 'shipped' && (req.body.notify !== false)) {
      await mailer.shippedConfirmation(updated, store.getOrganizerToken(updated));
    }
    res.json(projectDetail(updated));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Création manuelle d'un projet (commande hors Shopify, test, SAV)
router.post('/projects', json, async (req, res) => {
  const b = req.body || {};
  const email = String(b.organizer_email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'invalid_email' });
  const formula = b.formula_id ? store.getFormula(Number(b.formula_id)) : null;
  const capacity = Number(b.capacity) || (formula ? formula.max_contributors : 10);
  const { project, token } = store.createProject({
    organizerEmail: email,
    organizerName: b.organizer_name,
    formulaId: formula ? formula.id : null,
    capacity,
    recipientName: b.recipient_name,
    occasion: b.occasion,
    eventDate: b.event_date,
    projectName: b.project_name,
    shopify: { orderNumber: b.order_number },
  });
  if (b.send_email !== false) await mailer.projectAccess(project, token);
  res.status(201).json({ ...projectDetail(project), organizerUrl: `${config.BASE_URL}/o/${token}` });
});

// Renvoyer un lien d'accès (nouveau jeton, l'ancien est invalidé)
router.post('/projects/:id/resend-access', async (req, res) => {
  const p = projectOr404(req, res);
  if (!p) return;
  const token = store.rotateOrganizerToken(p.id);
  const ok = await mailer.newAccessLink(store.getProject(p.id), token);
  res.json({ ok, organizerUrl: `${config.BASE_URL}/o/${token}` });
});

router.post('/projects/:id/reset-reveal', (req, res) => {
  const p = projectOr404(req, res);
  if (!p) return;
  store.resetReveal(p.id);
  res.json({ ok: true });
});

router.post('/projects/:id/capacity', json, (req, res) => {
  const p = projectOr404(req, res);
  if (!p) return;
  const seats = Number(req.body && req.body.seats);
  if (!Number.isInteger(seats) || seats === 0) return res.status(400).json({ error: 'invalid_seats' });
  res.json(projectDetail(store.addCapacity(p.id, seats)));
});

// Association cadre NFC
router.post('/projects/:id/frame', json, (req, res) => {
  const p = projectOr404(req, res);
  if (!p) return;
  const raw = String((req.body && req.body.slug) || '').trim();
  const slug = raw.replace(/^.*\/f\//, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (slug.length < 6) return res.status(400).json({ error: 'invalid_slug' });
  try {
    store.linkFrame(slug, p.id);
    res.json(projectDetail(p));
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

router.delete('/projects/:id/frame', (req, res) => {
  const p = projectOr404(req, res);
  if (!p) return;
  store.unlinkFrame(p.id);
  res.json(projectDetail(p));
});

// Modération des contributions
router.delete('/projects/:id/contributions/:cid', (req, res) => {
  const p = projectOr404(req, res);
  if (!p) return;
  store.softDeleteContribution(Number(req.params.cid), p.id);
  res.json(projectDetail(p));
});

router.post('/projects/:id/contributions/:cid/restore', (req, res) => {
  const p = projectOr404(req, res);
  if (!p) return;
  store.restoreContribution(Number(req.params.cid), p.id);
  res.json(projectDetail(p));
});

// Photos : ajout, remplacement, suppression
router.post('/projects/:id/photos', h.rawImage(), async (req, res) => {
  const p = projectOr404(req, res);
  if (!p) return;
  if (!h.IMAGE_MIMES.has(h.contentType(req))) return res.status(415).json({ error: 'unsupported_format' });
  try {
    const result = await media.processPhoto(req.body, h.parseCropHeader(req));
    store.addPhoto(p.id, { source: 'admin', ...result });
    res.status(201).json(projectDetail(p));
  } catch (err) {
    res.status(422).json({ error: 'unreadable_image' });
  }
});

router.post('/projects/:id/photos/:pid/replace', h.rawImage(), async (req, res) => {
  const p = projectOr404(req, res);
  if (!p) return;
  const ph = store.getProjectPhoto(p.id, Number(req.params.pid));
  if (!ph) return res.status(404).json({ error: 'not_found' });
  if (!h.IMAGE_MIMES.has(h.contentType(req))) return res.status(415).json({ error: 'unsupported_format' });
  try {
    const result = await media.processPhoto(req.body, h.parseCropHeader(req));
    store.addPhoto(p.id, { contributionId: ph.contribution_id, source: 'admin', ...result });
    // La nouvelle photo reprend l'emplacement de l'ancienne
    const fresh = store.listPhotos(p.id, { doneOnly: false }).slice(-1)[0];
    if (ph.slot && fresh) {
      const { db } = require('../src/db');
      db.prepare('UPDATE photos SET slot = ? WHERE id = ?').run(ph.slot, fresh.id);
    }
    store.hardDeletePhoto(ph.id, p.id);
    media.deletePhotoFiles(ph);
    res.json(projectDetail(p));
  } catch (err) {
    res.status(422).json({ error: 'unreadable_image' });
  }
});

router.delete('/projects/:id/photos/:pid', (req, res) => {
  const p = projectOr404(req, res);
  if (!p) return;
  store.softDeletePhoto(Number(req.params.pid), p.id);
  res.json(projectDetail(p));
});

// Aperçu de la composition
router.get('/projects/:id/preview.svg', (req, res) => {
  const p = projectOr404(req, res);
  if (!p) return;
  const t = p.template_id ? store.getTemplate(p.template_id) : null;
  if (!t) return res.status(404).json({ error: 'no_template' });
  const svg = fs.readFileSync(path.join(config.TEMPLATES_DIR, t.file), 'utf8');
  const fills = {};
  for (const ph of store.listPhotos(p.id)) if (ph.slot) fills[ph.slot] = `/api/admin/media/photo/${ph.id}/square`;
  res.type('image/svg+xml').set('Cache-Control', 'no-store').send(
    renderPreview(svg, { slots: t.slots, viewBox: [0, 0, t.width_mm, t.height_mm], widthMm: t.width_mm, heightMm: t.height_mm, textZone: t.text_zone }, fills, { text: p.frame_text })
  );
});

// Export ZIP : tout le projet (photos originales et carrées, vocaux, textes, composition)
router.get('/projects/:id/export.zip', (req, res) => {
  const p = projectOr404(req, res);
  if (!p) return;
  const safe = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40);
  const name = `ravive_${p.slug}_${safe(p.recipient_name) || 'projet'}.zip`;
  res.attachment(name);
  const zip = new ZipArchive({ zlib: { level: 6 } });
  zip.on('error', (err) => { console.error('zip :', err.message); if (!res.headersSent) res.status(500).end(); });
  zip.pipe(res);

  const template = p.template_id ? store.getTemplate(p.template_id) : null;
  const contributions = store.listContributions(p.id);
  const photos = store.listPhotos(p.id);
  const memories = store.listProjectMemories(p.id);
  const manifest = {
    projet: {
      code: p.slug, destinataire: p.recipient_name, nom: p.project_name, occasion: p.occasion, date: p.event_date,
      organisateur: p.organizer_name, email: p.organizer_email, commande: p.shopify_order_number, statut: p.status,
      scelle_le: p.sealed_at, petit_mot: p.frame_text,
    },
    gabarit: template ? { cle: template.key, nom: template.name, emplacements: template.slot_count, fichier: template.file } : null,
    composition: photos.filter((ph) => ph.slot).sort((a, b) => a.slot - b.slot).map((ph) => ({
      emplacement: ph.slot, photo: `photos/carre/${ph.slot}_${ph.file_square}`, original: `photos/originales/${ph.file_original}`,
      recadrage: ph.crop ? JSON.parse(ph.crop) : null, proche: ph.contributor_name || null, source: ph.source,
    })),
    proches: contributions.map((c) => ({
      id: c.id, prenom: c.contributor_name, lien: c.relation, date: c.completed_at,
      photo_cadre: c.file_square ? `photos/carre/${(photos.find((ph) => ph.id === c.photo_id) || {}).slot || 'x'}_${c.file_square}` : null,
      souvenirs: memories.filter((m) => m.contribution_id === c.id).map((m) => ({
        id: m.id, type: m.kind, mot_libre: !!m.is_free, question: m.question_text, categorie: m.question_category, texte: m.text_body,
        vocal: m.audio_file ? `vocaux/${c.id}_${safe(c.contributor_name)}_${m.id}${path.extname(m.audio_file)}` : null, duree_s: m.audio_duration_s,
        photo: m.photo_square ? `photos/souvenirs/${m.id}_${m.photo_square}` : null,
        montre_en_premier: m.id === c.star_memory_id,
      })),
    })),
  };
  zip.append(JSON.stringify(manifest, null, 2), { name: 'projet.json' });
  if (template) zip.file(path.join(config.TEMPLATES_DIR, template.file), { name: `gabarit/${template.file}` });
  const texts = memories.filter((m) => m.kind === 'text').map((m) => `${m.contributor_name}\n${m.question_text || 'Mot libre'}\n\n${m.text_body}\n`).join('\n----------------------------------------\n\n');
  if (texts) zip.append(texts, { name: 'messages.txt' });
  for (const ph of photos) {
    zip.file(path.join(config.PHOTO_DIR, ph.file_original), { name: `photos/originales/${ph.file_original}` });
    zip.file(path.join(config.PHOTO_DIR, ph.file_square), { name: `photos/carre/${ph.slot || 'x'}_${ph.file_square}` });
  }
  for (const m of memories) {
    if (m.audio_file) zip.file(path.join(config.AUDIO_DIR, m.audio_file), { name: `vocaux/${m.contribution_id}_${safe(m.contributor_name)}_${m.id}${path.extname(m.audio_file)}` });
    if (m.photo_square) zip.file(path.join(config.PHOTO_DIR, m.photo_square), { name: `photos/souvenirs/${m.id}_${m.photo_square}` });
  }
  zip.finalize();
});

// Médias (admin voit tout, y compris les vocaux)
router.get('/media/photo/:id/:size', (req, res) => {
  const ph = store.getPhoto(Number(req.params.id));
  if (!ph) return res.status(404).json({ error: 'not_found' });
  const file = req.params.size === 'original' ? ph.file_original : req.params.size === 'square' ? ph.file_square : ph.file_thumb;
  h.sendPhotoFile(res, file, 'private, no-store');
});

router.get('/media/audio/:mid', (req, res) => {
  const m = store.getMemory(Number(req.params.mid));
  if (!m || !m.audio_file) return res.status(404).json({ error: 'not_found' });
  h.sendAudioFile(res, m.audio_file, m.audio_mime, 'private, no-store');
});

router.get('/media/selfie/:cid', (req, res) => {
  const ph = store.getContributionPhoto(Number(req.params.cid), 'selfie');
  h.sendPhotoFile(res, ph && ph.file_thumb, 'private, no-store');
});

// Modération d'un souvenir isolé
router.delete('/projects/:id/memories/:mid', (req, res) => {
  const p = projectOr404(req, res);
  if (!p) return;
  const m = store.getMemory(Number(req.params.mid));
  if (!m || m.project_id !== p.id) return res.status(404).json({ error: 'not_found' });
  store.setMemoryDeleted(m.id, true);
  res.json(projectDetail(p));
});
router.post('/projects/:id/memories/:mid/restore', (req, res) => {
  const p = projectOr404(req, res);
  if (!p) return;
  const m = store.getMemory(Number(req.params.mid));
  if (!m || m.project_id !== p.id) return res.status(404).json({ error: 'not_found' });
  store.setMemoryDeleted(m.id, false);
  res.json(projectDetail(p));
});

// ---------------------------------------------------------------------------
// Cadres NFC (lots)
// ---------------------------------------------------------------------------
router.get('/frames', (req, res) => {
  res.json({ baseUrl: config.BASE_URL, frames: store.listFrames({ unlinkedOnly: req.query.unlinked === '1' }) });
});

router.post('/frames', json, (req, res) => {
  const count = Number(req.body && req.body.count);
  if (!Number.isInteger(count) || count < 1 || count > 1000) return res.status(400).json({ error: 'invalid_count' });
  const frames = store.createFrames(count, req.body.label ? String(req.body.label).slice(0, 60) : null);
  res.json({ frames });
});

// ---------------------------------------------------------------------------
// Gabarits
// ---------------------------------------------------------------------------
router.get('/templates', (req, res) => res.json({ templates: store.listTemplates() }));

router.post('/templates', express.raw({ type: () => true, limit: '2mb' }), (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'empty' });
  const rawName = decodeURIComponent(String(req.headers['x-filename'] || 'gabarit.svg'));
  const key = path.basename(rawName, path.extname(rawName)).toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 60) || `gabarit_${Date.now()}`;
  try {
    const svg = sanitizeSvg(req.body.toString('utf8'));
    const parsed = parseTemplate(svg);
    const file = `${key}.svg`;
    fs.writeFileSync(path.join(config.TEMPLATES_DIR, file), svg);
    const name = decodeURIComponent(String(req.headers['x-name'] || '')) || `${parsed.slotCount} photos${parsed.hasText ? ' + petit mot' : ''}`;
    const t = store.upsertTemplate({ key, name, file, parsed });
    res.status(201).json({ template: t, warnings: parsed.warnings });
  } catch (err) {
    const msg = err.message === 'no_slots' ? 'Aucun emplacement photo trouvé (rect/path avec id photo_01… ou class="slot")' : err.message === 'not_svg' ? 'Le fichier n’est pas un SVG' : err.message;
    res.status(422).json({ error: msg });
  }
});

router.patch('/templates/:id', json, (req, res) => {
  const t = store.updateTemplate(Number(req.params.id), req.body || {});
  if (!t) return res.status(404).json({ error: 'not_found' });
  res.json({ template: t });
});

router.delete('/templates/:id', (req, res) => {
  const r = store.deleteTemplate(Number(req.params.id));
  if (r && r.file) { try { fs.unlinkSync(path.join(config.TEMPLATES_DIR, r.file)); } catch (_) { /* rien */ } }
  res.json({ result: r && r.deleted ? 'deleted' : r });
});

router.get('/templates/:id.svg', (req, res) => {
  const t = store.getTemplate(Number(req.params.id));
  if (!t) return res.status(404).end();
  res.type('image/svg+xml').sendFile(path.join(config.TEMPLATES_DIR, t.file));
});

// ---------------------------------------------------------------------------
// Questions, formules, réglages, visuels
// ---------------------------------------------------------------------------
router.get('/questions', (req, res) => res.json({ questions: store.listQuestions() }));
router.post('/questions', json, (req, res) => {
  try { res.status(201).json({ question: store.saveQuestion(req.body || {}) }); } catch (err) { res.status(400).json({ error: err.message }); }
});
router.patch('/questions/:id', json, (req, res) => {
  try { res.json({ question: store.saveQuestion({ ...(req.body || {}), id: Number(req.params.id) }) }); } catch (err) { res.status(400).json({ error: err.message }); }
});
router.delete('/questions/:id', (req, res) => { store.deleteQuestion(Number(req.params.id)); res.json({ ok: true }); });

router.get('/formulas', (req, res) => res.json({ formulas: store.listFormulas() }));
router.post('/formulas', json, (req, res) => {
  try { res.status(201).json({ formula: store.saveFormula(req.body || {}) }); } catch (err) { res.status(400).json({ error: err.message }); }
});
router.patch('/formulas/:id', json, (req, res) => {
  const f = store.getFormula(Number(req.params.id));
  if (!f) return res.status(404).json({ error: 'not_found' });
  try { res.json({ formula: store.saveFormula({ ...f, ...(req.body || {}), id: f.id }) }); } catch (err) { res.status(400).json({ error: err.message }); }
});
router.delete('/formulas/:id', (req, res) => res.json({ result: store.deleteFormula(Number(req.params.id)) }));

const EDITABLE_SETTINGS = {
  max_audio_s: (v) => Math.max(10, Math.min(600, Number(v) || 60)),
  max_text_chars: (v) => Math.max(50, Math.min(10000, Number(v) || 1000)),
  capacity_alert_pct: (v) => Math.max(10, Math.min(100, Number(v) || 80)),
  extra_seat_price_cents: (v) => Math.max(0, Math.round(Number(v) || 0)),
  extra_seat_shopify_variant_id: (v) => String(v || '').trim(),
  extra_seat_shopify_sku: (v) => String(v || '').trim(),
  reminder_days_before: (v) => Math.max(0, Math.min(60, Number(v) || 0)),
  fabrication_days: (v) => Math.max(1, Math.min(60, Number(v) || 7)),
  max_memories_per_contributor: (v) => Math.max(1, Math.min(20, Number(v) || 4)),
  brand_name: (v) => String(v || 'Ravive').trim().slice(0, 40),
  contact_email: (v) => String(v || '').trim().slice(0, 120),
  shop_url: (v) => String(v || '').trim().replace(/\/$/, '').slice(0, 200),
};

router.get('/settings', (req, res) => {
  const s = store.allSettings();
  res.json({
    settings: s,
    visuals: Object.fromEntries(Object.entries(s.visuals || {}).map(([k, v]) => [k, `/media/visuals/${v}`])),
    env: {
      baseUrl: config.BASE_URL,
      mail: config.BREVO_API_KEY ? `Brevo (${config.MAIL_FROM_EMAIL})` : 'non configuré : emails affichés dans la console',
      shopifyWebhook: config.SHOPIFY_WEBHOOK_SECRET ? 'secret configuré' : 'SHOPIFY_WEBHOOK_SECRET absent',
      shopifyDomain: config.SHOPIFY_SHOP_DOMAIN || '',
      webhookUrl: `${config.BASE_URL}/api/shopify/webhook`,
      ffmpeg: media.ffmpegAvailable() ? config.FFMPEG_PATH : 'absent : audio stocké tel quel',
    },
  });
});

router.put('/settings', json, (req, res) => {
  const b = req.body || {};
  for (const [k, norm] of Object.entries(EDITABLE_SETTINGS)) if (b[k] !== undefined) store.setSetting(k, norm(b[k]));
  res.json({ settings: store.allSettings() });
});

router.post('/visuals/:key', h.rawImage(), async (req, res) => {
  if (!h.IMAGE_MIMES.has(h.contentType(req))) return res.status(415).json({ error: 'unsupported_format' });
  const key = String(req.params.key).replace(/[^a-z0-9_-]/gi, '').slice(0, 40);
  if (!key) return res.status(400).json({ error: 'invalid_key' });
  try {
    const file = await media.storeVisual(req.body, key);
    const visuals = store.getSetting('visuals', {}) || {};
    if (visuals[key]) { try { fs.unlinkSync(path.join(config.VISUALS_DIR, visuals[key])); } catch (_) { /* rien */ } }
    visuals[key] = file;
    store.setSetting('visuals', visuals);
    res.json({ key, url: `/media/visuals/${file}` });
  } catch (err) {
    res.status(422).json({ error: 'unreadable_image' });
  }
});

router.delete('/visuals/:key', (req, res) => {
  const visuals = store.getSetting('visuals', {}) || {};
  const file = visuals[req.params.key];
  if (file) { try { fs.unlinkSync(path.join(config.VISUALS_DIR, file)); } catch (_) { /* rien */ } delete visuals[req.params.key]; store.setSetting('visuals', visuals); }
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Outils : test email, rejeu Shopify, tâches
// ---------------------------------------------------------------------------
router.post('/email/test', json, async (req, res) => {
  const ok = await mailer.testEmail(String((req.body && req.body.to) || ''));
  res.json({ ok });
});

router.post('/shopify/replay', json, async (req, res) => {
  const order = req.body && req.body.order;
  if (!order || !order.id) return res.status(400).json({ error: 'order_required' });
  try { res.json(await shopify.handlePaidOrder(order)); } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/shopify/events', (req, res) => {
  const { db } = require('../src/db');
  res.json({ events: db.prepare('SELECT * FROM shopify_events ORDER BY received_at DESC LIMIT 50').all() });
});

router.post('/jobs/run', async (req, res) => { await jobs.runAll(); res.json({ ok: true }); });

module.exports = router;
