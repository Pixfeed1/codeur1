'use strict';

/*
 * Traitement des médias (produit cadres).
 *
 * Photos : chaque photo déposée est conservée en trois versions JPEG dans
 * data/photos/ :
 *   - original  : recompressé, côté max 2400 px (base du fichier d'impression)
 *   - square    : recadrage carré choisi par le contributeur, 1200 px
 *   - thumb     : vignette carrée 400 px (listes, bibliothèque)
 * Les métadonnées EXIF sont retirées (vie privée), l'orientation appliquée.
 *
 * Audio : stocké tel que produit par le navigateur (webm/opus sur Android,
 * m4a/aac sur iPhone). Si ffmpeg est disponible (FFMPEG_PATH), le fichier est
 * converti en AAC 48 kbit/s mono, lisible partout et 3 à 5 fois plus léger.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const sharp = require('sharp');
const config = require('./config');

sharp.cache(false);

const ORIGINAL_MAX = 2400;
const SQUARE_SIZE = 1200;
const THUMB_SIZE = 400;

function id() {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * @param {Buffer} buffer image envoyée (jpeg/png/webp/heic si supporté)
 * @param {{x,y,w,h}|null} crop carré demandé, en pixels de l'image d'origine
 *        (après orientation). Sans crop : carré centré.
 * @returns {{ file_original, file_square, file_thumb, width, height, crop }}
 */
async function processPhoto(buffer, crop) {
  const base = id();
  const img = sharp(buffer, { failOn: 'none' }).rotate(); // applique l'orientation EXIF
  const meta = await img.metadata();
  const width = meta.width, height = meta.height;
  if (!width || !height) throw new Error('unreadable_image');

  // Recadrage : borné à l'image, forcé carré
  let c;
  const side = Math.min(width, height);
  if (crop && Number.isFinite(crop.x) && Number.isFinite(crop.y) && Number.isFinite(crop.w)) {
    const w = Math.max(64, Math.min(Math.round(crop.w), side));
    c = {
      left: Math.max(0, Math.min(Math.round(crop.x), width - w)),
      top: Math.max(0, Math.min(Math.round(crop.y), height - w)),
      width: w,
      height: w,
    };
  } else {
    c = { left: Math.round((width - side) / 2), top: Math.round((height - side) / 2), width: side, height: side };
  }

  const files = {
    file_original: `${base}-o.jpg`,
    file_square: `${base}-s.jpg`,
    file_thumb: `${base}-t.jpg`,
  };
  const dir = config.PHOTO_DIR;

  await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({ width: ORIGINAL_MAX, height: ORIGINAL_MAX, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(path.join(dir, files.file_original));

  const square = sharp(buffer, { failOn: 'none' }).rotate().extract(c);
  await square
    .clone()
    .resize(SQUARE_SIZE, SQUARE_SIZE, { fit: 'cover', withoutEnlargement: true })
    .jpeg({ quality: 86, mozjpeg: true })
    .toFile(path.join(dir, files.file_square));
  await square
    .clone()
    .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' })
    .jpeg({ quality: 80, mozjpeg: true })
    .toFile(path.join(dir, files.file_thumb));

  return { ...files, width, height, crop: { x: c.left, y: c.top, w: c.width, h: c.height } };
}

function deletePhotoFiles(photo) {
  for (const k of ['file_original', 'file_square', 'file_thumb']) {
    if (!photo[k]) continue;
    try {
      fs.unlinkSync(path.join(config.PHOTO_DIR, photo[k]));
    } catch (_) {
      /* déjà supprimé */
    }
  }
}

const AUDIO_EXT = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
};

function ffmpegAvailable() {
  return !!config.FFMPEG_PATH && fs.existsSync(config.FFMPEG_PATH);
}

/**
 * Enregistre un vocal. Avec ffmpeg : conversion en AAC mono 48 kbit/s (m4a) et
 * coupe à `maxSeconds`. Sans : le fichier est stocké tel quel.
 * @returns {Promise<{ file, mime, duration_s }>}
 */
function storeAudio(buffer, mime, durationHint, maxSeconds) {
  const ext = AUDIO_EXT[mime];
  if (!ext) throw new Error('unsupported_format');
  const base = id();
  const rawName = `${base}.${ext}`;
  const rawPath = path.join(config.AUDIO_DIR, rawName);
  fs.writeFileSync(rawPath, buffer);
  const duration = Math.min(Number(durationHint) || 0, maxSeconds);

  if (!ffmpegAvailable()) return Promise.resolve({ file: rawName, mime, duration_s: duration });

  const outName = `${base}.m4a`;
  const outPath = path.join(config.AUDIO_DIR, outName);
  const args = ['-y', '-loglevel', 'error', '-i', rawPath, '-t', String(maxSeconds), '-vn', '-ac', '1', '-c:a', 'aac', '-b:a', '48k', '-movflags', '+faststart', outPath];
  return new Promise((resolve) => {
    execFile(config.FFMPEG_PATH, args, { timeout: 60000 }, (err) => {
      if (err || !fs.existsSync(outPath)) {
        // Conversion impossible : on garde l'original, l'app reste fonctionnelle
        try { fs.unlinkSync(outPath); } catch (_) { /* rien */ }
        return resolve({ file: rawName, mime, duration_s: duration });
      }
      try { fs.unlinkSync(rawPath); } catch (_) { /* rien */ }
      resolve({ file: outName, mime: 'audio/mp4', duration_s: duration });
    });
  });
}

function deleteAudioFile(file) {
  if (!file) return;
  try {
    fs.unlinkSync(path.join(config.AUDIO_DIR, file));
  } catch (_) {
    /* déjà supprimé */
  }
}

/** Visuels d'illustration modifiables depuis l'admin (max 1600 px, JPEG ou PNG conservé). */
async function storeVisual(buffer, key) {
  const safe = String(key).replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'visual';
  const meta = await sharp(buffer, { failOn: 'none' }).metadata();
  const isPng = meta.format === 'png';
  const name = `${safe}-${id().slice(0, 6)}.${isPng ? 'png' : 'jpg'}`;
  let pipe = sharp(buffer, { failOn: 'none' }).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true });
  pipe = isPng ? pipe.png({ compressionLevel: 9 }) : pipe.jpeg({ quality: 85, mozjpeg: true });
  await pipe.toFile(path.join(config.VISUALS_DIR, name));
  return name;
}

module.exports = { processPhoto, deletePhotoFiles, storeAudio, deleteAudioFile, storeVisual, AUDIO_EXT, ffmpegAvailable };
