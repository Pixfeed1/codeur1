'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');

// Chargement minimal d'un fichier .env (pas de dépendance externe)
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
fs.mkdirSync(path.join(DATA_DIR, 'audio'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'photos'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'exports'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'templates'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'visuals'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'tmp'), { recursive: true });

// SECRET : signe les jetons d'activation et sale les codes.
// Généré et persisté automatiquement au premier lancement si absent,
// pour que le MVP fonctionne sans configuration manuelle.
let secret = process.env.SECRET;
if (!secret) {
  const secretFile = path.join(DATA_DIR, '.secret');
  if (fs.existsSync(secretFile)) {
    secret = fs.readFileSync(secretFile, 'utf8').trim();
  } else {
    secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(secretFile, secret, { mode: 0o600 });
  }
}

module.exports = {
  ROOT,
  DATA_DIR,
  AUDIO_DIR: path.join(DATA_DIR, 'audio'),
  PHOTO_DIR: path.join(DATA_DIR, 'photos'),
  EXPORTS_DIR: path.join(DATA_DIR, 'exports'),
  TEMPLATES_DIR: path.join(DATA_DIR, 'templates'),
  VISUALS_DIR: path.join(DATA_DIR, 'visuals'),
  TMP_DIR: path.join(DATA_DIR, 'tmp'),
  DB_FILE: path.join(DATA_DIR, 'ravive.db'),
  PORT: Number(process.env.PORT || 3000),
  BASE_URL: (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  SECRET: secret,
  ADMIN_USER: process.env.ADMIN_USER || '',
  ADMIN_TOKEN: process.env.ADMIN_TOKEN || '',
  // Durée max d'un message vocal (secondes) et taille max d'upload
  MAX_DURATION_S: Number(process.env.MAX_DURATION_S || 180),
  MAX_UPLOAD_BYTES: Number(process.env.MAX_UPLOAD_BYTES || 25 * 1024 * 1024),
  // Validité du jeton d'activation (l'acheteur a le temps d'enregistrer)
  TOKEN_TTL_S: Number(process.env.TOKEN_TTL_S || 60 * 60),
  // Nombre de proxys de confiance devant l'app (1 = un Nginx local).
  // 0/absent = app exposée en direct (dev).
  TRUST_PROXY: Number(process.env.TRUST_PROXY || 0),

  // --- Produit cadres ---
  // Taille max d'une photo envoyée (avant compression serveur)
  MAX_PHOTO_BYTES: Number(process.env.MAX_PHOTO_BYTES || 15 * 1024 * 1024),
  // Durée de vie d'un lien d'aperçu signé (destinataire, sans consommer le reveal)
  PREVIEW_TTL_S: Number(process.env.PREVIEW_TTL_S || 7 * 24 * 3600),
  // Emails transactionnels via Brevo (https://developers.brevo.com) ; sans clé,
  // les emails sont journalisés en base et affichés dans la console.
  BREVO_API_KEY: process.env.BREVO_API_KEY || '',
  MAIL_FROM_EMAIL: process.env.MAIL_FROM_EMAIL || 'bonjour@ravive.fr',
  MAIL_FROM_NAME: process.env.MAIL_FROM_NAME || 'Ravive',
  // Shopify : secret de signature des webhooks (Paramètres > Notifications > Webhooks)
  SHOPIFY_WEBHOOK_SECRET: process.env.SHOPIFY_WEBHOOK_SECRET || '',
  SHOPIFY_SHOP_DOMAIN: process.env.SHOPIFY_SHOP_DOMAIN || '', // ex. b1yfej-pc.myshopify.com
  // Chemin de ffmpeg pour la compression audio (facultatif ; absent = audio stocké tel quel)
  FFMPEG_PATH: process.env.FFMPEG_PATH || '',
};
