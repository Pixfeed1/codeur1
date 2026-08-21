'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');

const config = require('./src/config');
const db = require('./src/db');
const { issueToken, verifyToken } = require('./src/tokens');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(config.ROOT, 'public'), { maxAge: '1h' }));

// ---------------------------------------------------------------------------
// Anti-bruteforce sur les codes d'activation : 5 essais / 15 min par carte+IP
// ---------------------------------------------------------------------------
const attempts = new Map();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

function tooManyAttempts(key) {
  const now = Date.now();
  const list = (attempts.get(key) || []).filter((t) => now - t < WINDOW_MS);
  attempts.set(key, list);
  return list.length >= MAX_ATTEMPTS;
}
function recordAttempt(key) {
  const list = attempts.get(key) || [];
  list.push(Date.now());
  attempts.set(key, list);
}
setInterval(() => {
  const now = Date.now();
  for (const [key, list] of attempts) {
    const fresh = list.filter((t) => now - t < WINDOW_MS);
    if (fresh.length === 0) attempts.delete(key);
    else attempts.set(key, fresh);
  }
}, WINDOW_MS).unref();

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------
const VIEWS = path.join(config.ROOT, 'views');
const appTemplate = fs.readFileSync(path.join(VIEWS, 'app.html'), 'utf8');

function sendView(res, name, status = 200) {
  res.status(status).sendFile(path.join(VIEWS, name));
}

app.get('/', (req, res) => sendView(res, 'index.html'));
app.get('/mentions-legales', (req, res) => sendView(res, 'mentions-legales.html'));

// Page carte : la puce NFC pointe ici. Le même écran gère les deux parcours,
// l'état initial est injecté côté serveur (jamais le code, jamais le hash).
app.get('/c/:slug', (req, res) => {
  const card = db.getCard(req.params.slug);
  if (!card) return sendView(res, '404.html', 404);
  const state = {
    slug: card.slug,
    status: card.status,
    duration: card.duration_s || null,
    maxDuration: config.MAX_DURATION_S,
  };
  res
    .type('html')
    .send(appTemplate.replace('__STATE__', JSON.stringify(state).replace(/</g, '\\u003c')));
});

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

// Étape 1 (acheteur) : validation du code d'activation
app.post('/api/cards/:slug/activate', (req, res) => {
  const card = db.getCard(req.params.slug);
  if (!card) return res.status(404).json({ error: 'unknown_card' });
  if (card.status === 'recorded') return res.status(423).json({ error: 'already_recorded' });

  const key = `${card.slug}:${req.ip}`;
  if (tooManyAttempts(key)) return res.status(429).json({ error: 'too_many_attempts' });

  const code = String((req.body && req.body.code) || '').replace(/[\s-]/g, '');
  if (!code || !db.checkCode(card, code)) {
    recordAttempt(key);
    return res.status(401).json({ error: 'invalid_code' });
  }

  db.markActivated(card.slug);
  res.json({ token: issueToken(card.slug) });
});

// Étape 2 (acheteur) : upload du vocal validé — association définitive
const MIME_EXT = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
};

app.post(
  '/api/cards/:slug/message',
  express.raw({ type: () => true, limit: config.MAX_UPLOAD_BYTES }),
  (req, res) => {
    const card = db.getCard(req.params.slug);
    if (!card) return res.status(404).json({ error: 'unknown_card' });
    if (card.status === 'recorded') return res.status(423).json({ error: 'already_recorded' });

    const auth = String(req.headers.authorization || '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!verifyToken(token, card.slug)) return res.status(401).json({ error: 'invalid_token' });

    const mime = String(req.headers['content-type'] || '').split(';')[0].trim();
    const ext = MIME_EXT[mime];
    if (!ext) return res.status(415).json({ error: 'unsupported_format' });
    if (!Buffer.isBuffer(req.body) || req.body.length < 1000) {
      return res.status(400).json({ error: 'empty_audio' });
    }

    const duration = Math.min(Number(req.query.duration) || 0, config.MAX_DURATION_S);
    const file = `${card.slug}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(config.AUDIO_DIR, file), req.body);

    // attachRecording ne réussit qu'une fois (verrou en base) : si deux uploads
    // arrivent en même temps, un seul gagne, l'autre fichier est nettoyé.
    if (!db.attachRecording(card.slug, { file, mime, duration })) {
      fs.unlinkSync(path.join(config.AUDIO_DIR, file));
      return res.status(423).json({ error: 'already_recorded' });
    }
    res.json({ ok: true });
  }
);

// Lecture du vocal (destinataire) — streaming avec support des Range requests
app.get('/api/cards/:slug/audio', (req, res) => {
  const card = db.getCard(req.params.slug);
  if (!card || card.status !== 'recorded' || !card.audio_file) {
    return res.status(404).json({ error: 'no_audio' });
  }
  res.sendFile(path.join(config.AUDIO_DIR, card.audio_file), {
    headers: { 'Content-Type': card.audio_mime, 'Cache-Control': 'private, max-age=3600' },
  });
});

// ---------------------------------------------------------------------------
// Admin (facultatif) : liste des cartes, protégée par ADMIN_TOKEN
// ---------------------------------------------------------------------------
app.get('/api/admin/cards', (req, res) => {
  if (!config.ADMIN_TOKEN || req.headers.authorization !== `Bearer ${config.ADMIN_TOKEN}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  res.json(db.listCards());
});

app.use((req, res) => sendView(res, '404.html', 404));

app.listen(config.PORT, () => {
  console.log(`ravive en écoute sur ${config.BASE_URL} (port ${config.PORT})`);
});
