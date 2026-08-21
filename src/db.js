'use strict';

const Database = require('better-sqlite3');
const crypto = require('crypto');
const config = require('./config');

const db = new Database(config.DB_FILE);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,          -- identifiant unique encodé dans la puce NFC (URL)
    code_hash TEXT NOT NULL,            -- empreinte du code d'activation (jamais en clair)
    status TEXT NOT NULL DEFAULT 'pending',  -- pending | recorded
    audio_file TEXT,
    audio_mime TEXT,
    duration_s REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    activated_at TEXT,
    recorded_at TEXT
  );
`);

// Migration douce pour les bases déjà en place (colonnes photo)
for (const col of ['photo_file TEXT', 'photo_mime TEXT']) {
  try {
    db.exec(`ALTER TABLE cards ADD COLUMN ${col}`);
  } catch (err) {
    if (!String(err.message).includes('duplicate column')) throw err;
  }
}

// Alphabet sans caractères ambigus (pas de 0/O, 1/I/L…)
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function randomFrom(alphabet, length) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function hashCode(slug, code) {
  return crypto
    .createHmac('sha256', config.SECRET)
    .update(`${slug}:${code.toUpperCase()}`)
    .digest('hex');
}

function createCard() {
  // slug court, minuscule, sûr pour une URL : ravive.fr/c/<slug>
  for (;;) {
    const slug = randomFrom('abcdefghjkmnpqrstuvwxyz23456789', 10);
    const code = randomFrom(CODE_ALPHABET, 6);
    try {
      db.prepare('INSERT INTO cards (slug, code_hash) VALUES (?, ?)').run(slug, hashCode(slug, code));
      return { slug, code };
    } catch (err) {
      if (!String(err.message).includes('UNIQUE')) throw err;
      // collision de slug (rarissime) : on retente
    }
  }
}

function getCard(slug) {
  return db.prepare('SELECT * FROM cards WHERE slug = ?').get(slug);
}

function checkCode(card, code) {
  const expected = Buffer.from(card.code_hash, 'hex');
  const given = Buffer.from(hashCode(card.slug, code), 'hex');
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

function markActivated(slug) {
  db.prepare("UPDATE cards SET activated_at = datetime('now') WHERE slug = ? AND activated_at IS NULL").run(slug);
}

// Association définitive : ne réussit que si la carte est encore vierge.
function attachRecording(slug, { file, mime, duration, photoFile = null, photoMime = null }) {
  const res = db
    .prepare(
      `UPDATE cards SET status = 'recorded', audio_file = ?, audio_mime = ?, duration_s = ?,
       photo_file = ?, photo_mime = ?, recorded_at = datetime('now')
       WHERE slug = ? AND status = 'pending'`
    )
    .run(file, mime, duration, photoFile, photoMime, slug);
  return res.changes === 1;
}

function listCards() {
  return db
    .prepare(
      `SELECT slug, status, duration_s, photo_file IS NOT NULL AS has_photo,
       created_at, activated_at, recorded_at FROM cards ORDER BY id DESC`
    )
    .all();
}

module.exports = { db, createCard, getCard, checkCode, markActivated, attachRecording, listCards };
