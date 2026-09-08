'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');

const config = require('./src/config');
const db = require('./src/db');
const { issueToken, verifyToken } = require('./src/tokens');
const jobs = require('./src/jobs');

const app = express();
app.disable('x-powered-by');
// Derrière un reverse proxy (Nginx…), TRUST_PROXY=1 permet de récupérer la
// vraie IP client (X-Forwarded-For) — indispensable pour l'anti-bruteforce.
if (config.TRUST_PROXY) app.set('trust proxy', config.TRUST_PROXY);
// Le webhook Shopify vérifie la signature sur le corps brut : monté avant le parseur JSON
app.use(require('./routes/shopify'));
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
app.get('/confidentialite', (req, res) => sendView(res, 'confidentialite.html'));

// ---------------------------------------------------------------------------
// Produit cadres souvenirs : contributeur (/p), organisateur (/o),
// destinataire (/f, /apercu), webhook Shopify, administration.
// ---------------------------------------------------------------------------
app.use('/media/visuals', express.static(config.VISUALS_DIR, { maxAge: '7d', index: false }));
app.use(require('./routes/contributor'));
app.use(require('./routes/organizer'));
app.use(require('./routes/recipient'));

// Page carte : la puce NFC pointe ici. Le même écran gère les deux parcours,
// l'état initial est injecté côté serveur (jamais le code, jamais le hash).
app.get('/c/:slug', (req, res) => {
  const card = db.getCard(req.params.slug);
  if (!card) return sendView(res, '404.html', 404);
  const state = {
    slug: card.slug,
    status: card.status,
    duration: card.duration_s || null,
    hasPhoto: !!card.photo_file,
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

// Étape 2 (acheteur, facultative) : photo d'accompagnement.
// Stockée en attente ("pending-<slug>") tant que le vocal n'est pas validé ;
// elle n'est associée définitivement qu'avec lui.
const IMAGE_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const IMAGE_MIME = Object.fromEntries(Object.entries(IMAGE_EXT).map(([m, e]) => [e, m]));

function findPendingPhoto(slug) {
  const file = fs
    .readdirSync(config.PHOTO_DIR)
    .find((f) => f.startsWith(`pending-${slug}.`));
  return file || null;
}

function deletePendingPhoto(slug) {
  const file = findPendingPhoto(slug);
  if (file) fs.unlinkSync(path.join(config.PHOTO_DIR, file));
}

app.post(
  '/api/cards/:slug/photo',
  express.raw({ type: () => true, limit: '8mb' }),
  (req, res) => {
    const card = db.getCard(req.params.slug);
    if (!card) return res.status(404).json({ error: 'unknown_card' });
    if (card.status === 'recorded') return res.status(423).json({ error: 'already_recorded' });

    const auth = String(req.headers.authorization || '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!verifyToken(token, card.slug)) return res.status(401).json({ error: 'invalid_token' });

    const mime = String(req.headers['content-type'] || '').split(';')[0].trim();
    const ext = IMAGE_EXT[mime];
    if (!ext) return res.status(415).json({ error: 'unsupported_format' });
    if (!Buffer.isBuffer(req.body) || req.body.length < 100) {
      return res.status(400).json({ error: 'empty_photo' });
    }

    deletePendingPhoto(card.slug);
    fs.writeFileSync(path.join(config.PHOTO_DIR, `pending-${card.slug}.${ext}`), req.body);
    res.json({ ok: true });
  }
);

// Étape 3 (acheteur) : upload du vocal validé — association définitive
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

    // Photo : attachée uniquement si le client la confirme (?photo=1),
    // sinon la photo en attente est abandonnée (ex. retirée avant validation).
    let photoFile = null;
    let photoMime = null;
    const pending = findPendingPhoto(card.slug);
    if (req.query.photo === '1' && pending) {
      const photoExt = pending.split('.').pop();
      photoFile = `${card.slug}-${crypto.randomBytes(4).toString('hex')}.${photoExt}`;
      fs.renameSync(path.join(config.PHOTO_DIR, pending), path.join(config.PHOTO_DIR, photoFile));
      photoMime = IMAGE_MIME[photoExt];
    } else if (pending) {
      deletePendingPhoto(card.slug);
    }

    // attachRecording ne réussit qu'une fois (verrou en base) : si deux uploads
    // arrivent en même temps, un seul gagne, les fichiers de l'autre sont nettoyés.
    if (!db.attachRecording(card.slug, { file, mime, duration, photoFile, photoMime })) {
      fs.unlinkSync(path.join(config.AUDIO_DIR, file));
      if (photoFile) fs.unlinkSync(path.join(config.PHOTO_DIR, photoFile));
      return res.status(423).json({ error: 'already_recorded' });
    }
    res.json({ ok: true });
  }
);

// Photo associée (destinataire)
app.get('/api/cards/:slug/photo', (req, res) => {
  const card = db.getCard(req.params.slug);
  if (!card || card.status !== 'recorded' || !card.photo_file) {
    return res.status(404).json({ error: 'no_photo' });
  }
  res.sendFile(path.join(config.PHOTO_DIR, card.photo_file), {
    headers: { 'Content-Type': card.photo_mime, 'Cache-Control': 'private, max-age=3600' },
  });
});

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
// Admin : page de gestion des cartes, protégée par ADMIN_TOKEN (.env)
// ---------------------------------------------------------------------------
// Identifiants attendus : "identifiant:motdepasse" (ADMIN_USER / ADMIN_TOKEN du .env)
function requireAdmin(req, res) {
  if (!config.ADMIN_USER || !config.ADMIN_TOKEN) {
    res.status(503).json({ error: 'admin_disabled' });
    return false;
  }
  const auth = String(req.headers.authorization || '');
  const given = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const a = Buffer.from(given);
  const b = Buffer.from(`${config.ADMIN_USER}:${config.ADMIN_TOKEN}`);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}

app.get('/admin', (req, res) => sendView(res, 'admin.html'));

// API admin du produit cadres (même authentification)
app.use('/api/admin', (req, res, next) => (requireAdmin(req, res) ? next() : undefined), require('./routes/admin'));

app.get('/api/admin/cards', (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({ baseUrl: config.BASE_URL, cards: db.listCards() });
});

// Génération d'un lot : les codes ne sont renvoyés qu'ici, une seule fois
// (seule leur empreinte est conservée en base).
app.post('/api/admin/cards', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const count = Number(req.body && req.body.count);
  if (!Number.isInteger(count) || count < 1 || count > 1000) {
    return res.status(400).json({ error: 'invalid_count' });
  }
  const cards = [];
  for (let i = 0; i < count; i++) {
    const { slug, code } = db.createCard();
    cards.push({
      url: `${config.BASE_URL}/c/${slug}`,
      code: `${code.slice(0, 3)}-${code.slice(3)}`,
    });
  }
  res.json({ cards });
});

// Sonde de santé (supervision, load-balancer, docker healthcheck…)
app.get('/healthz', (req, res) => res.json({ ok: true }));

app.use((req, res) => sendView(res, '404.html', 404));

const server = app.listen(config.PORT, () => {
  console.log(`ravive en écoute sur ${config.BASE_URL} (port ${config.PORT})`);
  jobs.start();
});

// Arrêt propre (pm2 reload, docker stop, migration de serveur…)
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
