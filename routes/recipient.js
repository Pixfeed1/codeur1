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
  const contributions = store.listContributions(project.id);
  const seen = new Set();
  const items = contributions.map((c) => {
    const key = c.contributor_name.trim().toLowerCase();
    const inReveal = !seen.has(key);
    seen.add(key);
    return {
      id: c.id,
      name: c.contributor_name,
      kind: c.kind,
      question: c.question_text,
      text: c.kind === 'text' ? c.text_body : null,
      audio: c.kind === 'voice' ? `${base}/audio/${c.id}` : null,
      duration: c.audio_duration_s,
      photo: c.photo_id ? `${base}/photo/${c.photo_id}/square` : null,
      thumb: c.photo_id ? `${base}/photo/${c.photo_id}/thumb` : null,
      inReveal,
      date: c.completed_at,
    };
  });
  return {
    preview: !!preview,
    recipientName: project.recipient_name,
    organizerName: project.organizer_name,
    occasion: project.occasion,
    projectName: project.project_name,
    frameText: project.frame_text,
    firstAccess: !project.reveal_seen_at,
    ready: VISIBLE_STATUSES.has(project.status),
    status: project.status,
    count: items.length,
    items,
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

  router.get(`${prefix}/audio/:cid`, loader, (req, res) => {
    const c = store.getContribution(Number(req.params.cid));
    if (!c || c.project_id !== req.project.id || c.deleted_at || c.status !== 'done' || !c.audio_file) {
      return res.status(404).json({ error: 'not_found' });
    }
    h.sendAudioFile(res, c.audio_file, c.audio_mime);
  });
}

mountMedia('/api/f/:slug', loadFrame);
mountMedia('/api/apercu/:code/:p', loadPreview);

module.exports = router;
