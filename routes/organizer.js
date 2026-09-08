'use strict';

/*
 * Parcours organisateur : /o/<jeton privé>.
 *
 * Le jeton (32 caractères aléatoires, reçu par email) vaut authentification.
 * L'organisateur voit les prénoms et les photos, jamais les vocaux ni les
 * textes : ceux-ci sont réservés au destinataire (reveal).
 */

const express = require('express');
const store = require('../src/store');
const media = require('../src/media');
const mailer = require('../src/mailer');
const shopify = require('../src/shopify');
const config = require('../src/config');
const { renderPreview } = require('../src/templates');
const fs = require('fs');
const path = require('path');
const h = require('./helpers');

const router = express.Router();
const limitAccess = h.rateLimiter({ max: 5, windowMs: 15 * 60 * 1000 });

function loadProject(req, res, next) {
  const project = store.getProjectByOrganizerToken(String(req.params.token || ''));
  if (!project) return res.status(404).json({ error: 'unknown_project' });
  req.project = project;
  next();
}

function requireEditable(req, res, next) {
  if (!['preparing', 'collecting'].includes(req.project.status)) return res.status(423).json({ error: 'sealed' });
  next();
}

function photoView(ph, token) {
  return {
    id: ph.id,
    source: ph.source,
    contributorName: ph.contributor_name || null,
    slot: ph.slot,
    thumb: `/api/o/${token}/photos/${ph.id}/thumb`,
    square: `/api/o/${token}/photos/${ph.id}/square`,
    createdAt: ph.created_at,
  };
}

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function dashboardState(project, token) {
  const contributions = store.listContributions(project.id).map((c) => ({
    id: c.id,
    name: c.contributor_name,
    relation: c.relation,
    kinds: c.kinds ? c.kinds.split(',') : [], // types de souvenirs, jamais leur contenu
    memories: c.memories_count,
    hasPhoto: !!c.photo_id,
    selfie: c.selfie_thumb ? `/api/o/${token}/contributions/${c.id}/selfie` : null,
    completedAt: c.completed_at,
  }));
  const fabricationDays = Number(store.getSetting('fabrication_days', 7));
  const today = new Date().toISOString().slice(0, 10);
  const deadline = project.deadline;
  const recommendedDeadline = project.event_date ? (addDays(project.event_date, -10) > today ? addDays(project.event_date, -10) : today) : addDays(today, 14);
  const photos = store.listPhotos(project.id).map((ph) => photoView(ph, token));
  const templates = store.listTemplates(true).map((t) => ({
    id: t.id,
    key: t.key,
    name: t.name,
    slotCount: t.slot_count,
    hasText: t.has_text,
    slots: t.slots,
    textZone: t.text_zone,
    widthMm: t.width_mm,
    heightMm: t.height_mm,
    svg: `/api/o/${token}/templates/${t.id}.svg`,
  }));
  const frame = store.getFrameByProject(project.id);
  return {
    token,
    project: {
      slug: project.slug,
      recipientName: project.recipient_name,
      recipientGender: project.recipient_gender || 'f',
      projectName: project.project_name,
      occasion: project.occasion,
      eventDate: project.event_date,
      deadline,
      recommendedDeadline,
      estimatedDelivery: addDays(deadline || today, fabricationDays),
      daysLeft: deadline ? Math.max(0, Math.round((new Date(deadline + 'T00:00') - new Date(today + 'T00:00')) / 86400000)) : null,
      fabricationDays,
      organizerName: project.organizer_name,
      organizerEmail: project.organizer_email,
      status: project.status,
      capacity: project.capacity,
      used: store.countDone(project.id),
      templateId: project.template_id,
      frameText: project.frame_text,
      sealedAt: project.sealed_at,
      shippedAt: project.shipped_at,
      createdAt: project.created_at,
      setupDone: !!project.setup_at && !!project.recipient_name,
    },
    participationUrl: `${config.BASE_URL}/p/${project.slug}`,
    frameUrl: frame ? `${config.BASE_URL}/f/${frame.slug}` : null,
    previewUrl: `${config.BASE_URL}/apercu/${project.slug}?p=${h.issuePreviewToken(project.id)}`,
    extraSeatsUrl: shopify.extraSeatsUrl(project),
    extraSeatPriceCents: Number(store.getSetting('extra_seat_price_cents', 0)) || null,
    contributions,
    photos,
    templates,
    statuses: store.STATUSES,
    relations: store.getSetting('relations', []),
    visuals: h.publicVisuals(store),
  };
}

// Page tableau de bord
router.get('/o/:token', (req, res) => {
  const project = store.getProjectByOrganizerToken(String(req.params.token || ''));
  if (!project) return h.renderView(res, 'organizer.html', { error: 'unknown' }, 404);
  h.renderView(res, 'organizer.html', dashboardState(project, req.params.token));
});

router.get('/api/o/:token', loadProject, (req, res) => res.json(dashboardState(req.project, req.params.token)));

// Création / mise à jour des informations du projet
router.post('/api/o/:token/setup', loadProject, requireEditable, express.json({ limit: '8kb' }), (req, res) => {
  const b = req.body || {};
  if (!String(b.recipient_name || req.project.recipient_name || '').trim()) return res.status(400).json({ error: 'recipient_required' });
  try {
    store.setupProject(req.project.id, b);
    res.json(dashboardState(store.getProject(req.project.id), req.params.token));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Photos ajoutées par l'organisateur
router.post('/api/o/:token/photos', loadProject, requireEditable, h.rawImage(), async (req, res) => {
  if (!h.IMAGE_MIMES.has(h.contentType(req))) return res.status(415).json({ error: 'unsupported_format' });
  if (!Buffer.isBuffer(req.body) || req.body.length < 100) return res.status(400).json({ error: 'empty_photo' });
  try {
    const result = await media.processPhoto(req.body, h.parseCropHeader(req));
    const photo = store.addPhoto(req.project.id, { source: 'organizer', ...result });
    res.status(201).json(photoView({ ...photo, contributor_name: null }, req.params.token));
  } catch (err) {
    res.status(422).json({ error: 'unreadable_image' });
  }
});

router.delete('/api/o/:token/photos/:id', loadProject, requireEditable, (req, res) => {
  const ph = store.getProjectPhoto(req.project.id, Number(req.params.id));
  if (!ph) return res.status(404).json({ error: 'not_found' });
  if (ph.source !== 'organizer') return res.status(403).json({ error: 'not_yours' });
  store.hardDeletePhoto(ph.id, req.project.id);
  media.deletePhotoFiles(ph);
  res.json({ ok: true });
});

router.get('/api/o/:token/photos/:id/:size', loadProject, (req, res) => {
  const ph = store.getProjectPhoto(req.project.id, Number(req.params.id));
  if (!ph || ph.deleted_at) return res.status(404).json({ error: 'not_found' });
  const file = req.params.size === 'square' ? ph.file_square : ph.file_thumb;
  h.sendPhotoFile(res, file);
});

router.get('/api/o/:token/contributions/:id/selfie', loadProject, (req, res) => {
  const c = store.getContribution(Number(req.params.id));
  if (!c || c.project_id !== req.project.id) return res.status(404).json({ error: 'not_found' });
  const ph = store.getContributionPhoto(c.id, 'selfie');
  h.sendPhotoFile(res, ph && ph.file_thumb);
});

// Gabarits (SVG brut, pour l'aperçu dans le composeur)
router.get('/api/o/:token/templates/:id.svg', loadProject, (req, res) => {
  const t = store.getTemplate(Number(req.params.id));
  if (!t) return res.status(404).end();
  res.type('image/svg+xml').set('Cache-Control', 'private, max-age=3600').sendFile(path.join(config.TEMPLATES_DIR, t.file));
});

// Composition : gabarit + affectation photo → emplacement + petit mot
function validateComposition(project, body) {
  const t = store.getTemplate(Number(body.templateId));
  if (!t || !t.active) throw Object.assign(new Error('unknown_template'), { status: 400 });
  const photos = new Map(store.listPhotos(project.id).map((p) => [p.id, p]));
  const assignments = [];
  const usedSlots = new Set();
  const usedPhotos = new Set();
  for (const a of Array.isArray(body.assignments) ? body.assignments : []) {
    const photoId = Number(a.photoId), slot = Number(a.slot);
    if (!photos.has(photoId)) throw Object.assign(new Error('unknown_photo'), { status: 400 });
    if (!Number.isInteger(slot) || slot < 1 || slot > t.slot_count) throw Object.assign(new Error('invalid_slot'), { status: 400 });
    if (usedSlots.has(slot) || usedPhotos.has(photoId)) throw Object.assign(new Error('duplicate_assignment'), { status: 400 });
    usedSlots.add(slot);
    usedPhotos.add(photoId);
    assignments.push({ photoId, slot });
  }
  const frameText = t.has_text && body.frameText ? String(body.frameText).trim().slice(0, 200) : null;
  return { template: t, assignments, frameText };
}

router.put('/api/o/:token/composition', loadProject, requireEditable, express.json({ limit: '64kb' }), (req, res) => {
  try {
    const { template, assignments, frameText } = validateComposition(req.project, req.body || {});
    store.setComposition(req.project.id, template.id, assignments, frameText);
    res.json({ ok: true, filled: assignments.length, slotCount: template.slot_count, complete: assignments.length === template.slot_count });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Aperçu SVG de la composition enregistrée
router.get('/api/o/:token/preview.svg', loadProject, (req, res) => {
  const p = req.project;
  const t = p.template_id ? store.getTemplate(p.template_id) : null;
  if (!t) return res.status(404).json({ error: 'no_template' });
  const svg = fs.readFileSync(path.join(config.TEMPLATES_DIR, t.file), 'utf8');
  const fills = {};
  for (const ph of store.listPhotos(p.id)) if (ph.slot) fills[ph.slot] = `/api/o/${req.params.token}/photos/${ph.id}/square`;
  res.type('image/svg+xml').set('Cache-Control', 'no-store').send(
    renderPreview(svg, { slots: t.slots, viewBox: [0, 0, t.width_mm, t.height_mm], widthMm: t.width_mm, heightMm: t.height_mm, textZone: t.text_zone }, fills, { text: p.frame_text })
  );
});

// Scellement : composition complète obligatoire, action irréversible
router.post('/api/o/:token/seal', loadProject, express.json({ limit: '2kb' }), async (req, res) => {
  const p = req.project;
  if (p.status !== 'collecting') return res.status(423).json({ error: 'not_collecting' });
  if (!(req.body && req.body.confirm === true)) return res.status(400).json({ error: 'confirmation_required' });
  const t = p.template_id ? store.getTemplate(p.template_id) : null;
  if (!t) return res.status(400).json({ error: 'no_template' });
  const filled = store.listPhotos(p.id).filter((ph) => ph.slot).length;
  if (filled !== t.slot_count) return res.status(400).json({ error: 'composition_incomplete', filled, slotCount: t.slot_count });
  if (!store.sealProject(p.id)) return res.status(423).json({ error: 'not_collecting' });
  const sealed = store.getProject(p.id);
  mailer.sealedConfirmation(sealed, req.params.token).catch(() => {});
  res.json(dashboardState(sealed, req.params.token));
});

// ---------------------------------------------------------------------------
// Lien perdu : la page /acces renvoie un nouveau lien par email
// ---------------------------------------------------------------------------
router.get('/acces', (req, res) => h.renderView(res, 'access.html', { visuals: h.publicVisuals(store) }));

router.post('/api/access', express.json({ limit: '2kb' }), async (req, res) => {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'invalid_email' });
  if (!limitAccess(req.ip)) return res.status(429).json({ error: 'too_many_requests' });
  // Réponse identique qu'il existe ou non des projets (pas d'énumération d'adresses)
  const projects = store.getProjectsByEmail(email);
  for (const p of projects) {
    const token = store.rotateOrganizerToken(p.id);
    await mailer.newAccessLink(p, token);
  }
  res.json({ ok: true });
});

module.exports = router;
