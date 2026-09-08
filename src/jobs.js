'use strict';

/*
 * Tâches périodiques (dans le processus de l'application, sans cron externe) :
 *   - rappel avant la date de l'événement (projets en collecte, une fois) ;
 *   - purge des contributions abandonnées et de leurs fichiers.
 * Lancées 1 min après le démarrage puis toutes les heures.
 */

const store = require('./store');
const media = require('./media');
const mailer = require('./mailer');

async function sendReminders() {
  const days = Number(store.getSetting('reminder_days_before', 3));
  if (!(days >= 0)) return;
  for (const p of store.projectsNeedingReminder(days)) {
    store.markReminder(p.id);
    const left = Math.round((new Date(p.event_date) - new Date(new Date().toISOString().slice(0, 10))) / 86400000);
    await mailer.closingReminder(p, store.getOrganizerToken(p), left);
  }
}

function purgeDrafts() {
  const rows = store.purgeDrafts(24);
  for (const r of rows) {
    if (r.audio_file) media.deleteAudioFile(r.audio_file);
    if (r.file_original) media.deletePhotoFiles(r);
  }
  // les photos des souvenirs ont déjà leurs lignes photos supprimées ci-dessus
  if (rows.length) console.log(`[jobs] ${rows.length} brouillon(s) de contribution purgé(s)`);
}

async function runAll() {
  try { await sendReminders(); } catch (err) { console.error('[jobs] rappels :', err.message); }
  try { purgeDrafts(); } catch (err) { console.error('[jobs] purge :', err.message); }
}

function start() {
  setTimeout(runAll, 60 * 1000).unref();
  setInterval(runAll, 60 * 60 * 1000).unref();
}

module.exports = { start, runAll, sendReminders, purgeDrafts };
