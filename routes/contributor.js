'use strict';

/*
 * Parcours contributeur : /p/<code> — sans compte (maquette v5).
 *
 *   1. POST /api/p/:slug/contributions              { name, relation }  → { id, token }
 *      POST .../:id/selfie   (image brute)           photo de profil, facultative
 *      POST .../:id/photo    (image brute, X-Crop)   photo pour le cadre, facultative
 *   2. GET  /api/p/:slug/questions                   questions actives, mélangées, genrées
 *      POST .../:id/memories             { kind:'text', text, free, question, category, questionId }
 *      POST .../:id/memories/audio       (audio brut, ?duration=&free=&question=&category=)
 *      POST .../:id/memories/photo       (image brute, ?question=&category=)
 *      PUT  .../:id/memories/:mid        { text }      DELETE .../:id/memories/:mid
 *   3. POST .../:id/complete             { star: memoryId }
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

function daysLeft(project) {
  const end = project.deadline || project.event_date;
  if (!end) return null;
  return Math.max(0, Math.round((new Date(end + 'T00:00') - new Date(new Date().toISOString().slice(0, 10) + 'T00:00')) / 86400000));
}

function publicState(project) {
  return {
    slug: project.slug,
    recipientName: project.recipient_name,
    recipientGender: project.recipient_gender || 'f',
    organizerName: project.organizer_name,
    occasion: project.occasion,
    projectName: project.project_name,
    open: project.status === 'collecting',
    full: store.usedSeats(project.id) >= project.capacity,
    used: store.countDone(project.id),
    capacity: project.capacity,
    daysLeft: daysLeft(project),
    deadline: project.deadline,
    maxAudioS: Number(store.getSetting('max_audio_s', 60)),
    maxTextChars: Number(store.getSetting('max_text_chars', 1000)),
    maxMemories: Number(store.getSetting('max_memories_per_contributor', 4)),
    relations: store.getSetting('relations', []),
    categories: store.questionCategories(),
    visuals: h.publicVisuals(store),
  };
}

function memoryView(m, slug, id, token) {
  return {
    id: m.id,
    kind: m.kind,
    free: !!m.is_free,
    question: m.question_text,
    category: m.question_category,
    text: m.text_body,
    duration: m.audio_duration_s,
    audio: m.audio_file ? `/api/p/${slug}/contributions/${id}/memories/${m.id}/audio?t=${token}` : null,
    photo: m.photo_id ? `/api/p/${slug}/contributions/${id}/photos/${m.photo_id}?t=${token}` : null,
  };
}

// Pages
router.get('/p/:slug', (req, res) => {
  const project = store.getProjectBySlug(String(req.params.slug || '').toLowerCase());
  if (!project) return h.renderView(res, 'contribute.html', { notFound: true }, 404);
  h.renderView(res, 'contribute.html', publicState(project));
});

router.get('/api/p/:slug', loadProject, (req, res) => res.json(publicState(req.project)));

// Questions : toutes les actives, mélangées, genrées et personnalisées
router.get('/api/p/:slug/questions', loadProject, (req, res) => {
  const p = req.project;
  const cats = new Map(store.questionCategories().map((c) => [c.key, c]));
  const list = store.listQuestions(true).map((q) => ({
    id: q.id,
    text: store.fillQuestion(q.text, p.recipient_name, p.recipient_gender),
    category: q.category,
    icon: cats.has(q.category) ? cats.get(q.category).icon : '✨',
    title: cats.has(q.category) ? cats.get(q.category).title : '',
  }));
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  res.json({ questions: list });
});

// 1. Prénom (+ lien) → contribution brouillon
router.post('/api/p/:slug/contributions', loadProject, express.json({ limit: '8kb' }), (req, res) => {
  const p = req.project;
  if (p.status !== 'collecting') return res.status(423).json({ error: 'closed' });
  if (!limitCreate(`${p.id}:${req.ip}`)) return res.status(429).json({ error: 'too_many_requests' });
  const name = String((req.body && req.body.name) || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (name.length < 1) return res.status(400).json({ error: 'name_required' });
  if (store.usedSeats(p.id) >= p.capacity) return res.status(409).json({ error: 'project_full' });
  const { contribution, token } = store.createContribution(p.id, { name, relation: req.body.relation });
  res.status(201).json({ id: contribution.id, token });
});

router.patch('/api/p/:slug/contributions/:id', loadProject, loadContribution, express.json({ limit: '8kb' }), (req, res) => {
  const c = store.updateContribution(req.contribution.id, req.body || {});
  res.json({ id: c.id, name: c.contributor_name, relation: c.relation });
});

// Photo pour le cadre (rôle main) et selfie (rôle selfie)
async function storeRolePhoto(req, res, role) {
  if (!h.IMAGE_MIMES.has(h.contentType(req))) return res.status(415).json({ error: 'unsupported_format' });
  if (!Buffer.isBuffer(req.body) || req.body.length < 100) return res.status(400).json({ error: 'empty_photo' });
  try {
    const result = await media.processPhoto(req.body, h.parseCropHeader(req));
    for (const old of store.replaceContributionPhoto(req.contribution.id, role)) media.deletePhotoFiles(old);
    const photo = store.addPhoto(req.project.id, { contributionId: req.contribution.id, source: 'contributor', role, ...result });
    res.json({ photoId: photo.id, url: `/api/p/${req.project.slug}/contributions/${req.contribution.id}/photos/${photo.id}?t=${h.bearer(req)}`, crop: result.crop });
  } catch (err) {
    console.error('photo contributeur :', err.message);
    res.status(422).json({ error: 'unreadable_image' });
  }
}
router.post('/api/p/:slug/contributions/:id/photo', loadProject, loadContribution, h.rawImage(), (req, res) => storeRolePhoto(req, res, 'main'));
router.post('/api/p/:slug/contributions/:id/selfie', loadProject, loadContribution, h.rawImage(), (req, res) => storeRolePhoto(req, res, 'selfie'));
router.delete('/api/p/:slug/contributions/:id/photo', loadProject, loadContribution, (req, res) => {
  for (const old of store.replaceContributionPhoto(req.contribution.id, 'main')) media.deletePhotoFiles(old);
  res.json({ ok: true });
});

// Médias du contributeur (aperçu de ses propres photos / vocaux pendant le parcours)
function loadByQueryToken(req, res, next) {
  const c = store.getContributionByToken(req.project.id, Number(req.params.id), String(req.query.t || ''));
  if (!c) return res.status(401).json({ error: 'invalid_token' });
  req.contribution = c;
  next();
}
router.get('/api/p/:slug/contributions/:id/photos/:pid', loadProject, loadByQueryToken, (req, res) => {
  const ph = store.getPhoto(Number(req.params.pid));
  if (!ph || ph.contribution_id !== req.contribution.id) return res.status(404).json({ error: 'not_found' });
  h.sendPhotoFile(res, ph.file_square, 'private, no-store');
});
router.get('/api/p/:slug/contributions/:id/memories/:mid/audio', loadProject, loadByQueryToken, (req, res) => {
  const m = store.getMemory(Number(req.params.mid));
  if (!m || m.contribution_id !== req.contribution.id || !m.audio_file) return res.status(404).json({ error: 'not_found' });
  h.sendAudioFile(res, m.audio_file, m.audio_mime, 'private, no-store');
});

// 2. Souvenirs
function memoryMeta(src) {
  return {
    isFree: src.free === '1' || src.free === true || src.free === 1,
    questionText: src.question ? String(src.question).slice(0, 300) : null,
    questionCategory: src.category ? String(src.category).slice(0, 40) : null,
    questionId: src.questionId ? Number(src.questionId) || null : null,
  };
}

function checkMemoryQuota(req, res) {
  const max = Number(store.getSetting('max_memories_per_contributor', 4)) + 1; // + le mot libre
  if (store.countMemories(req.contribution.id) >= max) {
    res.status(409).json({ error: 'too_many_memories', max });
    return false;
  }
  return true;
}

router.post('/api/p/:slug/contributions/:id/memories', loadProject, loadContribution, express.json({ limit: '16kb' }), (req, res) => {
  const b = req.body || {};
  const max = Number(store.getSetting('max_text_chars', 1000));
  const text = String(b.text || '').replace(/\r\n/g, '\n').trim();
  if (text.length < 1) return res.status(400).json({ error: 'text_required' });
  if (text.length > max) return res.status(400).json({ error: 'text_too_long', max });
  if (!checkMemoryQuota(req, res)) return;
  const m = store.addMemory(req.project.id, req.contribution.id, { kind: 'text', text, ...memoryMeta(b) });
  res.status(201).json(memoryView(m, req.project.slug, req.contribution.id, h.bearer(req)));
});

router.post('/api/p/:slug/contributions/:id/memories/audio', loadProject, loadContribution, h.rawAudio(), async (req, res) => {
  const mime = h.contentType(req);
  if (!media.AUDIO_EXT[mime]) return res.status(415).json({ error: 'unsupported_format' });
  if (!Buffer.isBuffer(req.body) || req.body.length < 1000) return res.status(400).json({ error: 'empty_audio' });
  if (!checkMemoryQuota(req, res)) return;
  try {
    const stored = await media.storeAudio(req.body, mime, Number(req.query.duration), Number(store.getSetting('max_audio_s', 60)));
    const m = store.addMemory(req.project.id, req.contribution.id, { kind: 'voice', audio: stored, ...memoryMeta(req.query) });
    res.status(201).json(memoryView(m, req.project.slug, req.contribution.id, h.bearer(req)));
  } catch (err) {
    console.error('audio contributeur :', err.message);
    res.status(500).json({ error: 'store_failed' });
  }
});

router.post('/api/p/:slug/contributions/:id/memories/photo', loadProject, loadContribution, h.rawImage(), async (req, res) => {
  if (!h.IMAGE_MIMES.has(h.contentType(req))) return res.status(415).json({ error: 'unsupported_format' });
  if (!Buffer.isBuffer(req.body) || req.body.length < 100) return res.status(400).json({ error: 'empty_photo' });
  if (!checkMemoryQuota(req, res)) return;
  try {
    const result = await media.processPhoto(req.body, h.parseCropHeader(req));
    const photo = store.addPhoto(req.project.id, { contributionId: req.contribution.id, source: 'contributor', role: 'memory', ...result });
    const m = store.addMemory(req.project.id, req.contribution.id, { kind: 'photo', photoId: photo.id, ...memoryMeta(req.query) });
    res.status(201).json(memoryView(m, req.project.slug, req.contribution.id, h.bearer(req)));
  } catch (err) {
    res.status(422).json({ error: 'unreadable_image' });
  }
});

router.put('/api/p/:slug/contributions/:id/memories/:mid', loadProject, loadContribution, express.json({ limit: '16kb' }), (req, res) => {
  const m = store.getMemory(Number(req.params.mid));
  if (!m || m.contribution_id !== req.contribution.id) return res.status(404).json({ error: 'not_found' });
  const max = Number(store.getSetting('max_text_chars', 1000));
  const text = String((req.body && req.body.text) || '').replace(/\r\n/g, '\n').trim();
  if (text.length < 1) return res.status(400).json({ error: 'text_required' });
  if (text.length > max) return res.status(400).json({ error: 'text_too_long', max });
  if (m.audio_file) media.deleteAudioFile(m.audio_file);
  res.json(memoryView(store.updateMemoryText(m.id, text), req.project.slug, req.contribution.id, h.bearer(req)));
});

router.delete('/api/p/:slug/contributions/:id/memories/:mid', loadProject, loadContribution, (req, res) => {
  const m = store.getMemory(Number(req.params.mid));
  if (!m || m.contribution_id !== req.contribution.id) return res.status(404).json({ error: 'not_found' });
  const r = store.deleteMemory(m.id);
  if (r.memory.audio_file) media.deleteAudioFile(r.memory.audio_file);
  if (r.photo) media.deletePhotoFiles(r.photo);
  res.json({ ok: true });
});

router.get('/api/p/:slug/contributions/:id/memories', loadProject, loadContribution, (req, res) => {
  const c = req.contribution;
  const t = h.bearer(req);
  const photoUrl = (ph) => (ph ? `/api/p/${req.project.slug}/contributions/${c.id}/photos/${ph.id}?t=${t}` : null);
  const main = store.getContributionPhoto(c.id, 'main');
  const selfie = store.getContributionPhoto(c.id, 'selfie');
  res.json({
    star: c.star_memory_id,
    name: c.name,
    relation: c.relation,
    photo: main ? { photoId: main.id, url: photoUrl(main) } : null,
    selfie: photoUrl(selfie),
    memories: store.listMemories(c.id).map((m) => memoryView(m, req.project.slug, c.id, t)),
  });
});

// 3. Validation : au moins un souvenir ; l'étoile désigne celui du reveal
router.post('/api/p/:slug/contributions/:id/complete', loadProject, loadContribution, express.json({ limit: '2kb' }), async (req, res) => {
  const p = req.project;
  const c = req.contribution;
  if (p.status !== 'collecting') return res.status(423).json({ error: 'closed' });
  if (store.countMemories(c.id) === 0) return res.status(400).json({ error: 'memory_required' });
  const star = req.body && Number(req.body.star);
  if (star) {
    const m = store.getMemory(star);
    if (m && m.contribution_id === c.id) store.setStarMemory(c.id, m.id);
  }
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
