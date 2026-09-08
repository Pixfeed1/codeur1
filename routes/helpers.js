'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const config = require('../src/config');

const VIEWS = path.join(config.ROOT, 'views');
const viewCache = new Map();

// Page HTML avec état initial injecté (jamais de secret dedans)
function renderView(res, name, state = {}, status = 200) {
  let tpl = viewCache.get(name);
  if (!tpl || process.env.NODE_ENV !== 'production') {
    tpl = fs.readFileSync(path.join(VIEWS, name), 'utf8');
    viewCache.set(name, tpl);
  }
  const json = JSON.stringify(state).replace(/</g, '\\u003c');
  res.status(status).type('html').send(tpl.replace('__STATE__', json));
}

function sendView(res, name, status = 200) {
  res.status(status).sendFile(path.join(VIEWS, name));
}

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'image/avif']);

function rawImage(limit) {
  return express.raw({ type: () => true, limit: limit || config.MAX_PHOTO_BYTES });
}

function rawAudio() {
  return express.raw({ type: () => true, limit: config.MAX_UPLOAD_BYTES });
}

function contentType(req) {
  return String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
}

function bearer(req) {
  const auth = String(req.headers.authorization || '');
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
}

function parseCropHeader(req) {
  try {
    const raw = req.headers['x-crop'];
    if (!raw) return null;
    const c = JSON.parse(String(raw));
    return { x: Number(c.x), y: Number(c.y), w: Number(c.w), h: Number(c.h) };
  } catch (_) {
    return null;
  }
}

// Limiteur simple en mémoire : max `max` appels par `windowMs` et par clé
function rateLimiter({ max, windowMs }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, list] of hits) {
      const fresh = list.filter((t) => now - t < windowMs);
      if (fresh.length) hits.set(k, fresh);
      else hits.delete(k);
    }
  }, windowMs).unref();
  return (key) => {
    const now = Date.now();
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) return false;
    list.push(now);
    hits.set(key, list);
    return true;
  };
}

// Jetons d'aperçu signés (expérience destinataire sans consommer le reveal)
function sign(payload) {
  return crypto.createHmac('sha256', config.SECRET).update(payload).digest('base64url');
}

function issuePreviewToken(projectId) {
  const exp = Math.floor(Date.now() / 1000) + config.PREVIEW_TTL_S;
  const payload = `pv.${projectId}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

function verifyPreviewToken(token, projectId) {
  if (typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'pv') return false;
  if (String(parts[1]) !== String(projectId)) return false;
  if (Number(parts[2]) < Math.floor(Date.now() / 1000)) return false;
  const expected = sign(parts.slice(0, 3).join('.'));
  const a = Buffer.from(parts[3]);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sendPhotoFile(res, file, cache = 'private, max-age=86400') {
  if (!file) return res.status(404).json({ error: 'not_found' });
  res.sendFile(path.join(config.PHOTO_DIR, file), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': cache } }, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'not_found' });
  });
}

function sendAudioFile(res, file, mime, cache = 'private, max-age=86400') {
  if (!file) return res.status(404).json({ error: 'not_found' });
  res.sendFile(path.join(config.AUDIO_DIR, file), { headers: { 'Content-Type': mime || 'application/octet-stream', 'Cache-Control': cache } }, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'not_found' });
  });
}

function publicVisuals(store) {
  const visuals = store.getSetting('visuals', {}) || {};
  const out = {};
  for (const [k, v] of Object.entries(visuals)) out[k] = `/media/visuals/${v}`;
  return out;
}

module.exports = {
  renderView,
  sendView,
  rawImage,
  rawAudio,
  contentType,
  bearer,
  parseCropHeader,
  rateLimiter,
  issuePreviewToken,
  verifyPreviewToken,
  sendPhotoFile,
  sendAudioFile,
  publicVisuals,
  IMAGE_MIMES,
};
