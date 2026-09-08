'use strict';

/*
 * Parcours contributeur : /p/<code> — sans compte.
 *
 *   1. POST /api/p/:slug/contributions            { name }        → { id, token, question }
 *   2. POST /api/p/:slug/contributions/:id/photo  (image brute, en-tête X-Crop)
 *   3. POST /api/p/:slug/contributions/:id/audio  (audio brut, ?duration=)
 *      ou   /api/p/:slug/contributions/:id/text   { text }
 *   4. POST /api/p/:slug/contributions/:id/complete
 *
 * Le jeton renvoyé à l'étape 1 autorise les étapes suivantes pour cette
 * contribution uniquement. Un brouillon non validé est purgé après 24 h.
 */

const express = require('express');
const store = require('../src/store');
const media = require('../src/media');
const mailer = require('../src/mailer');
const shopify = require('../src/shopify');
const h = require('./helpers');

const router = express.Router();
const limitCreate = h.rateLimiter({ max: 30, windowMs: 15 * 60 * 1000 });

function loadProject(req, res, next) {
  const project = store.getProjectBySlug(String(req.params.slug || '').toLowerCase());
  if (!project) return res.status(404).json({ error: 'unknown_project' });
  req.project = project;
  next();
}

function loadContribution(req, res, next) {
  const c = store.getContributionByToken(req.project.id, Number(req.params.id), h.bearer(req));
  if (!c) return res.status(401).json({ error: 'invalid_token' });
  if (c.status !== 'draft') return res.status(423).json({ error: 'already_completed' });
  req.contribution = c;
  next();
}

function publicState(project) {
  const used = store.countDone(project.id);
  return {
    slug: project.slug,
    recipientName: project.recipient_name,
    organizerName: project.organizer_name,
    occasion: project.occasion,
    projectName: project.project_name,
    open: project.status === 'collecting',
    full: store.usedSeats(project.id) >= project.capacity,
    used,
    capacity: project.capacity,
    maxAudioS: Number(store.getSetting('max_audio_s', 60)),
    maxTextChars: Number(store.getSetting('max_text_chars', 1000)),
    visuals: h.publicVisuals(store),
  };
}

// Page
router.get('/p/:slug', (req, res) => {
  const project = store.getProjectBySlug(String(req.params.slug || '').toLowerCase());
  if (!project) return h.sendView(res, '404.html', 404);
  h.renderView(res, 'contribute.html', publicState(project));
});

router.get('/api/p/:slug', loadProject, (req, res) => res.json(publicState(req.project)));

// 1. Prénom → contribution brouillon + question
router.post('/api/p/:slug/contributions', loadProject, express.json({ limit: '8kb' }), (req, res) => {
  const p = req.project;
  if (p.status !== 'collecting') return res.status(423).json({ error: 'closed' });
  if (!limitCreate(`${p.id}:${req.ip}`)) return res.status(429).json({ error: 'too_many_requests' });
  const name = String((req.body && req.body.name) || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (name.length < 1) return res.status(400).json({ error: 'name_required' });
  if (store.usedSeats(p.id) >= p.capacity) return res.status(409).json({ error: 'project_full' });

  const q = store.pickQuestion(p.id);
  const questionText = q ? store.fillQuestion(q.text, p.recipient_name) : null;
  const { contribution, token } = store.createContribution(p.id, { name, questionId: q && q.id, questionText });
  res.status(201).json({
    id: contribution.id,
    token,
    question: q ? { id: q.id, text: questionText } : null,
  });
});

// Autre question (le contributeur peut en demander une différente)
router.post('/api/p/:slug/contributions/:id/question', loadProject, loadContribution, (req, res) => {
  const active = store.listQuestions(true).filter((q) => q.id !== req.contribution.question_id);
  const pool = active.length ? active : store.listQuestions(true);
  if (!pool.length) return res.json({ question: null });
  const q = pool[Math.floor(Math.random() * pool.length)];
  const text = store.fillQuestion(q.text, req.project.recipient_name);
  store.setContributionQuestion(req.contribution.id, q.id, text);
  res.json({ question: { id: q.id, text } });
});

// 2. Photo (recadrage carré demandé par le client dans X-Crop, en px de l'original)
router.post('/api/p/:slug/contributions/:id/photo', loadProject, loadContribution, h.rawImage(), async (req, res) => {
  if (!h.IMAGE_MIMES.has(h.contentType(req))) return res.status(415).json({ error: 'unsupported_format' });
  if (!Buffer.isBuffer(req.body) || req.body.length < 100) return res.status(400).json({ error: 'empty_photo' });
  try {
    const result = await media.processPhoto(req.body, h.parseCropHeader(req));
    for (const old of store.replaceContributionPhoto(req.contribution.id)) media.deletePhotoFiles(old);
    const photo = store.addPhoto(req.project.id, { contributionId: req.contribution.id, source: 'contributor', ...result });
    res.json({ photoId: photo.id, width: result.width, height: result.height, crop: result.crop });
  } catch (err) {
    console.error('photo contributeur :', err.message);
    res.status(422).json({ error: 'unreadable_image' });
  }
});

// 3a. Vocal
router.post('/api/p/:slug/contributions/:id/audio', loadProject, loadContribution, h.rawAudio(), async (req, res) => {
  const mime = h.contentType(req);
  if (!media.AUDIO_EXT[mime]) return res.status(415).json({ error: 'unsupported_format' });
  if (!Buffer.isBuffer(req.body) || req.body.length < 1000) return res.status(400).json({ error: 'empty_audio' });
  const maxS = Number(store.getSetting('max_audio_s', 60));
  try {
    const old = req.contribution.audio_file;
    const stored = await media.storeAudio(req.body, mime, Number(req.query.duration), maxS);
    store.setContributionVoice(req.contribution.id, stored);
    if (old) media.deleteAudioFile(old);
    res.json({ ok: true, duration: stored.duration_s });
  } catch (err) {
    console.error('audio contributeur :', err.message);
    res.status(500).json({ error: 'store_failed' });
  }
});

// 3b. Texte
router.post('/api/p/:slug/contributions/:id/text', loadProject, loadContribution, express.json({ limit: '16kb' }), (req, res) => {
  const max = Number(store.getSetting('max_text_chars', 1000));
  const text = String((req.body && req.body.text) || '').replace(/\r\n/g, '\n').trim();
  if (text.length < 2) return res.status(400).json({ error: 'text_required' });
  if (text.length > max) return res.status(400).json({ error: 'text_too_long', max });
  const old = req.contribution.audio_file;
  store.setContributionText(req.contribution.id, text);
  if (old) media.deleteAudioFile(old);
  res.json({ ok: true });
});

// 4. Validation : la contribution devient visible (organisateur : photo seulement)
router.post('/api/p/:slug/contributions/:id/complete', loadProject, loadContribution, async (req, res) => {
  const p = req.project;
  const c = store.getContribution(req.contribution.id);
  if (p.status !== 'collecting') return res.status(423).json({ error: 'closed' });
  if (!c.kind) return res.status(400).json({ error: 'memory_required' });
  const hasPhoto = store.listPhotos(p.id, { doneOnly: false }).some((ph) => ph.contribution_id === c.id);
  if (!hasPhoto) return res.status(400).json({ error: 'photo_required' });
  if (!store.completeContribution(c.id)) return res.status(423).json({ error: 'already_completed' });

  // Relance de capacité : une seule fois par palier, réinitialisée à chaque extension
  const used = store.countDone(p.id);
  const pct = Number(store.getSetting('capacity_alert_pct', 80));
  if (!p.capacity_alert_sent_at && used >= Math.ceil((p.capacity * pct) / 100)) {
    store.markCapacityAlert(p.id);
    mailer
      .capacityAlert(p, store.getOrganizerToken(p), {
        used,
        extraUrl: shopify.extraSeatsUrl(p),
        extraPrice: Number(store.getSetting('extra_seat_price_cents', 0)) || null,
      })
      .catch((err) => console.error('relance capacité :', err.message));
  }
  res.json({ ok: true, used, capacity: p.capacity });
});

module.exports = router;
