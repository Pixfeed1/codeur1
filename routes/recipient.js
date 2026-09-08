'use strict';

/*
 * Parcours destinataire : /f/<slug du cadre> (URL encodée dans la puce NFC).
 *
 * - Premier accès : reveal (un souvenir par proche), puis bibliothèque.
 * - Accès suivants : écran d'accueil (revivre le reveal / bibliothèque).
 * - Mode aperçu : /apercu/<code projet>?p=<jeton signé> — même expérience,
 *   sans jamais marquer le reveal comme vu. Utilisé par l'organisateur et
 *   l'administration pour tester.
 *
 * Les contenus ne sont servis que pour un projet scellé (ou plus avancé),
 * sauf en aperçu où l'état « en cours de collecte » est aussi visible.
 */

const express = require('express');
const store = require('../src/store');
const h = require('./helpers');

const router = express.Router();

const VISIBLE_STATUSES = new Set(['sealed', 'production', 'shipped', 'done']);

function resolveFrame(req) {
  const frame = store.getFrameBySlug(String(req.params.slug || '').toLowerCase());
  if (!frame) return null;
  const project = frame.project_id ? store.getProject(frame.project_id) : null;
  return { frame, project };
}

function resolvePreview(req) {
  const project = store.getProjectBySlug(String(req.params.code || '').toLowerCase());
  if (!project) return null;
  if (!h.verifyPreviewToken(String(req.query.p || ''), project.id)) return null;
  return { project, preview: true };
}

function memoriesState(project, { preview, base }) {
  // Un item par souvenir ; regroupés par proche. Le reveal montre le souvenir
  // étoilé de chaque proche (ou le premier), la bibliothèque montre tout.
  const rows = store.listProjectMemories(project.id);
  const seen = new Set();
  const items = rows.map((m) => {
    const isStar = m.star_memory_id ? m.id === m.star_memory_id : !seen.has(m.contribution_id);
    const inReveal = isStar && !seen.has(m.contribution_id);
    if (inReveal) seen.add(m.contribution_id);
    return {
      id: m.id,
      contributionId: m.contribution_id,
      name: m.contributor_name,
      relation: m.relation,
      selfie: m.selfie_thumb ? `${base}/selfie/${m.contribution_id}` : null,
      kind: m.kind,
      free: !!m.is_free,
      question: m.question_text,
      category: m.question_category,
      text: m.kind === 'text' ? m.text_body : null,
      audio: m.kind === 'voice' ? `${base}/audio/${m.id}` : null,
      duration: m.audio_duration_s,
      photo: m.photo_id ? `${base}/photo/${m.photo_id}/square` : null,
      background: m.photo_id ? `${base}/photo/${m.photo_id}/square` : m.main_square ? `${base}/main/${m.contribution_id}` : null,
      inReveal,
      date: m.completed_at,
    };
  });
  const people = [];
  const byId = new Map();
  for (const it of items) {
    if (!byId.has(it.contributionId)) {
      const person = { id: it.contributionId, name: it.name, relation: it.relation, selfie: it.selfie, photo: it.background && !it.photo ? it.background : null, memories: [] };
      byId.set(it.contributionId, person);
      people.push(person);
    }
    byId.get(it.contributionId).memories.push(it);
  }
  return {
    preview: !!preview,
    recipientName: project.recipient_name,
    recipientGender: project.recipient_gender || 'f',
    organizerName: project.organizer_name,
    occasion: project.occasion,
    projectName: project.project_name,
    frameText: project.frame_text,
    firstAccess: !project.reveal_seen_at,
    ready: VISIBLE_STATUSES.has(project.status),
    status: project.status,
    count: people.length,
    items,
    people,
    categories: store.questionCategories(),
    visuals: h.publicVisuals(store),
  };
}

// --- Pages ---
router.get('/f/:slug', (req, res) => {
  const r = resolveFrame(req);
  if (!r) return h.renderView(res, 'recipient.html', { notFound: true }, 404);
  // Cadre fabriqué mais projet pas encore associé ou pas encore scellé
  if (!r.project || !VISIBLE_STATUSES.has(r.project.status)) return h.renderView(res, 'recipient.html', { notReady: true, visuals: h.publicVisuals(store) });
  h.renderView(res, 'recipient.html', { ...memoriesState(r.project, { base: `/api/f/${r.frame.slug}` }), api: `/api/f/${r.frame.slug}` });
});

router.get('/apercu/:code', (req, res) => {
  const r = resolvePreview(req);
  if (!r) return h.renderView(res, 'recipient.html', { notFound: true }, 404);
  const base = `/api/apercu/${r.project.slug}/${encodeURIComponent(String(req.query.p))}`;
  h.renderView(res, 'recipient.html', { ...memoriesState(r.project, { preview: true, base }), api: base });
});

// --- API cadre ---
function loadFrame(req, res, next) {
  const r = resolveFrame(req);
  if (!r || !r.project || !VISIBLE_STATUSES.has(r.project.status)) return res.status(404).json({ error: 'not_found' });
  req.project = r.project;
  req.base = `/api/f/${r.frame.slug}`;
  next();
}

function loadPreview(req, res, next) {
  const project = store.getProjectBySlug(String(req.params.code || '').toLowerCase());
  if (!project || !h.verifyPreviewToken(String(req.params.p || ''), project.id)) return res.status(404).json({ error: 'not_found' });
  req.project = project;
  req.preview = true;
  req.base = `/api/apercu/${project.slug}/${encodeURIComponent(String(req.params.p))}`;
  next();
}

function mountMedia(prefix, loader) {
  router.get(`${prefix}`, loader, (req, res) => res.json(memoriesState(req.project, { preview: req.preview, base: req.base })));

  router.post(`${prefix}/reveal-done`, loader, (req, res) => {
    if (!req.preview) store.markRevealSeen(req.project.id);
    res.json({ ok: true });
  });

  router.get(`${prefix}/photo/:id/:size`, loader, (req, res) => {
    const ph = store.getProjectPhoto(req.project.id, Number(req.params.id));
    if (!ph || ph.deleted_at) return res.status(404).json({ error: 'not_found' });
    h.sendPhotoFile(res, req.params.size === 'thumb' ? ph.file_thumb : ph.file_square);
  });

  router.get(`${prefix}/audio/:mid`, loader, (req, res) => {
    const m = store.getMemory(Number(req.params.mid));
    if (!m || m.project_id !== req.project.id || m.deleted_at || !m.audio_file) return res.status(404).json({ error: 'not_found' });
    const c = store.getContribution(m.contribution_id);
    if (!c || c.status !== 'done' || c.deleted_at) return res.status(404).json({ error: 'not_found' });
    h.sendAudioFile(res, m.audio_file, m.audio_mime);
  });

  router.get(`${prefix}/selfie/:cid`, loader, (req, res) => {
    const c = store.getContribution(Number(req.params.cid));
    if (!c || c.project_id !== req.project.id) return res.status(404).json({ error: 'not_found' });
    const ph = store.getContributionPhoto(c.id, 'selfie');
    h.sendPhotoFile(res, ph && ph.file_thumb);
  });

  router.get(`${prefix}/main/:cid`, loader, (req, res) => {
    const c = store.getContribution(Number(req.params.cid));
    if (!c || c.project_id !== req.project.id) return res.status(404).json({ error: 'not_found' });
    const ph = store.getContributionPhoto(c.id, 'main');
    h.sendPhotoFile(res, ph && ph.file_square);
  });
}

mountMedia('/api/f/:slug', loadFrame);
mountMedia('/api/apercu/:code/:p', loadPreview);

module.exports = router;
