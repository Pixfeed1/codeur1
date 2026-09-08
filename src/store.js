'use strict';

/*
 * Accès aux données du produit cadres. Toutes les requêtes SQL du produit
 * passent par ici ; les routes ne manipulent jamais SQLite directement.
 */

const crypto = require('crypto');
const config = require('./config');
const { db } = require('./db');
const { STATUSES } = require('./schema');

const SLUG_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

function randomSlug(length) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += SLUG_ALPHABET[bytes[i] % SLUG_ALPHABET.length];
  return out;
}

function newToken() {
  return crypto.randomBytes(24).toString('base64url'); // 32 caractères URL-safe
}

function hashToken(token) {
  return crypto.createHmac('sha256', config.SECRET).update(String(token)).digest('hex');
}

// Le jeton organisateur est recherché par empreinte (hashToken) mais aussi
// conservé chiffré (AES-256-GCM, clé dérivée de SECRET) pour pouvoir figurer
// dans les emails de relance sans invalider le lien déjà en usage.
const ENC_KEY = crypto.createHash('sha256').update(`ravive-token:${config.SECRET}`).digest();

function encryptToken(token) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const enc = Buffer.concat([cipher.update(String(token), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64url');
}

function decryptToken(blob) {
  if (!blob) return null;
  try {
    const buf = Buffer.from(String(blob), 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
  } catch (_) {
    return null;
  }
}

function getOrganizerToken(project) {
  return decryptToken(project.organizer_token_enc);
}

function now() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

// ---------------------------------------------------------------------------
// Réglages
// ---------------------------------------------------------------------------
function getSetting(key, def = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return def;
  try {
    return JSON.parse(row.value);
  } catch (_) {
    return row.value;
  }
}

function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, JSON.stringify(value));
}

function allSettings() {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) {
    try { out[r.key] = JSON.parse(r.value); } catch (_) { out[r.key] = r.value; }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Formules
// ---------------------------------------------------------------------------
function listFormulas(activeOnly = false) {
  return db
    .prepare(`SELECT * FROM formulas ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY sort_order, id`)
    .all();
}

function getFormula(id) {
  return db.prepare('SELECT * FROM formulas WHERE id = ?').get(id);
}

function findFormulaForLineItem({ variantId, sku }) {
  if (variantId) {
    const f = db.prepare('SELECT * FROM formulas WHERE shopify_variant_id = ? AND active = 1').get(String(variantId));
    if (f) return f;
  }
  if (sku) {
    const f = db.prepare('SELECT * FROM formulas WHERE shopify_sku = ? COLLATE NOCASE AND active = 1').get(String(sku));
    if (f) return f;
  }
  return null;
}

function saveFormula(data) {
  const fields = {
    name: String(data.name || '').trim(),
    max_contributors: Math.max(1, Math.min(1000, Number(data.max_contributors) || 0)),
    price_cents: Math.max(0, Math.round(Number(data.price_cents) || 0)),
    shopify_variant_id: data.shopify_variant_id ? String(data.shopify_variant_id).trim() : null,
    shopify_sku: data.shopify_sku ? String(data.shopify_sku).trim() : null,
    active: data.active === false || data.active === 0 ? 0 : 1,
    sort_order: Number(data.sort_order) || 0,
  };
  if (!fields.name || !fields.max_contributors) throw new Error('invalid_formula');
  if (data.id) {
    db.prepare(
      `UPDATE formulas SET name=@name, max_contributors=@max_contributors, price_cents=@price_cents,
       shopify_variant_id=@shopify_variant_id, shopify_sku=@shopify_sku, active=@active, sort_order=@sort_order
       WHERE id=@id`
    ).run({ ...fields, id: data.id });
    return getFormula(data.id);
  }
  const r = db
    .prepare(
      `INSERT INTO formulas (name, max_contributors, price_cents, shopify_variant_id, shopify_sku, active, sort_order)
       VALUES (@name, @max_contributors, @price_cents, @shopify_variant_id, @shopify_sku, @active, @sort_order)`
    )
    .run(fields);
  return getFormula(r.lastInsertRowid);
}

function deleteFormula(id) {
  const used = db.prepare('SELECT COUNT(*) AS n FROM projects WHERE formula_id = ?').get(id).n;
  if (used > 0) {
    db.prepare('UPDATE formulas SET active = 0 WHERE id = ?').run(id);
    return 'deactivated';
  }
  db.prepare('DELETE FROM formulas WHERE id = ?').run(id);
  return 'deleted';
}

// ---------------------------------------------------------------------------
// Gabarits
// ---------------------------------------------------------------------------
function rowToTemplate(r) {
  if (!r) return null;
  return {
    ...r,
    slots: JSON.parse(r.slots),
    text_zone: r.text_zone ? JSON.parse(r.text_zone) : null,
    has_text: !!r.has_text,
    active: !!r.active,
  };
}

function listTemplates(activeOnly = false) {
  return db
    .prepare(`SELECT * FROM templates ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY sort_order, slot_count, id`)
    .all()
    .map(rowToTemplate);
}

function getTemplate(id) {
  return rowToTemplate(db.prepare('SELECT * FROM templates WHERE id = ?').get(id));
}

function getTemplateByKey(key) {
  return rowToTemplate(db.prepare('SELECT * FROM templates WHERE key = ?').get(key));
}

function upsertTemplate({ key, name, file, parsed, sortOrder }) {
  const existing = getTemplateByKey(key);
  const fields = {
    key,
    name,
    file,
    slot_count: parsed.slotCount,
    has_text: parsed.hasText ? 1 : 0,
    slots: JSON.stringify(parsed.slots),
    text_zone: parsed.textZone ? JSON.stringify(parsed.textZone) : null,
    width_mm: parsed.widthMm,
    height_mm: parsed.heightMm,
    sort_order: sortOrder != null ? sortOrder : existing ? existing.sort_order : parsed.slotCount,
  };
  if (existing) {
    db.prepare(
      `UPDATE templates SET name=@name, file=@file, slot_count=@slot_count, has_text=@has_text, slots=@slots,
       text_zone=@text_zone, width_mm=@width_mm, height_mm=@height_mm, sort_order=@sort_order WHERE key=@key`
    ).run(fields);
    return getTemplateByKey(key);
  }
  db.prepare(
    `INSERT INTO templates (key, name, file, slot_count, has_text, slots, text_zone, width_mm, height_mm, sort_order)
     VALUES (@key, @name, @file, @slot_count, @has_text, @slots, @text_zone, @width_mm, @height_mm, @sort_order)`
  ).run(fields);
  return getTemplateByKey(key);
}

function updateTemplate(id, { name, active, sort_order }) {
  const t = getTemplate(id);
  if (!t) return null;
  db.prepare('UPDATE templates SET name = ?, active = ?, sort_order = ? WHERE id = ?').run(
    name != null ? String(name).trim() : t.name,
    active != null ? (active ? 1 : 0) : t.active ? 1 : 0,
    sort_order != null ? Number(sort_order) : t.sort_order,
    id
  );
  return getTemplate(id);
}

function deleteTemplate(id) {
  const used = db.prepare('SELECT COUNT(*) AS n FROM projects WHERE template_id = ?').get(id).n;
  if (used > 0) {
    db.prepare('UPDATE templates SET active = 0 WHERE id = ?').run(id);
    return 'deactivated';
  }
  const t = getTemplate(id);
  db.prepare('DELETE FROM templates WHERE id = ?').run(id);
  return t ? { deleted: true, file: t.file } : 'deleted';
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------
function listQuestions(activeOnly = false) {
  return db
    .prepare(`SELECT * FROM questions ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY sort_order, id`)
    .all();
}

function saveQuestion(data) {
  const text = String(data.text || '').trim().slice(0, 300);
  if (!text) throw new Error('invalid_question');
  const active = data.active === false || data.active === 0 ? 0 : 1;
  const sort = Number(data.sort_order) || 0;
  const category = data.category ? String(data.category).trim().slice(0, 40) : null;
  if (data.id) {
    db.prepare('UPDATE questions SET text = ?, active = ?, sort_order = ?, category = ? WHERE id = ?').run(text, active, sort, category, data.id);
    return db.prepare('SELECT * FROM questions WHERE id = ?').get(data.id);
  }
  const r = db.prepare('INSERT INTO questions (text, active, sort_order, category) VALUES (?, ?, ?, ?)').run(text, active, sort, category);
  return db.prepare('SELECT * FROM questions WHERE id = ?').get(r.lastInsertRowid);
}

function deleteQuestion(id) {
  db.prepare('DELETE FROM questions WHERE id = ?').run(id);
}

// Les questions sont rédigées au féminin avec {prenom} facultatif ; pour un
// destinataire masculin, on bascule les pronoms (règles de la maquette v5).
function genderize(text, gender) {
  if (gender !== 'm') return text;
  return String(text)
    .replace(/à elle/g, 'à lui').replace(/pour elle/g, 'pour lui').replace(/avec elle/g, 'avec lui').replace(/chez elle/g, 'chez lui')
    .replace(/\belle\b/g, 'il').replace(/\bElle\b/g, 'Il').replace(/\bcelle\b/g, 'celui')
    .replace(/heureux\/se/g, 'heureux').replace(/\bla connaît\b/g, 'le connaît').replace(/\bla fêtée\b/g, 'le fêté');
}

function fillQuestion(text, recipientName, gender) {
  const name = recipientName || (gender === 'm' ? 'lui' : 'elle');
  return genderize(String(text).replace(/\{pr[ée]nom\}|\{p\}/gi, name), gender);
}

// Catégories de questions (réglage) : [clé, icône, titre, accroche]
function questionCategories() {
  const cats = getSetting('question_categories', []) || [];
  return cats.map((c) => ({ key: c[0], icon: c[1], title: c[2], head: c[3] || '' }));
}

// Question proposée à un contributeur : la moins utilisée dans ce projet,
// pour varier les souvenirs, avec tirage aléatoire à égalité.
function pickQuestion(projectId) {
  const active = listQuestions(true);
  if (active.length === 0) return null;
  const used = new Map(
    db
      .prepare('SELECT question_id, COUNT(*) AS n FROM contributions WHERE project_id = ? AND question_id IS NOT NULL GROUP BY question_id')
      .all(projectId)
      .map((r) => [r.question_id, r.n])
  );
  let best = [];
  let min = Infinity;
  for (const q of active) {
    const n = used.get(q.id) || 0;
    if (n < min) { min = n; best = [q]; } else if (n === min) best.push(q);
  }
  return best[Math.floor(Math.random() * best.length)];
}

// ---------------------------------------------------------------------------
// Cadres NFC
// ---------------------------------------------------------------------------
function createFrames(count, label) {
  const out = [];
  const ins = db.prepare('INSERT INTO frames (slug, label) VALUES (?, ?)');
  for (let i = 0; i < count; i++) {
    for (;;) {
      const slug = randomSlug(10);
      try {
        ins.run(slug, label || null);
        out.push({ slug, url: `${config.BASE_URL}/f/${slug}` });
        break;
      } catch (err) {
        if (!String(err.message).includes('UNIQUE')) throw err;
      }
    }
  }
  return out;
}

function getFrameBySlug(slug) {
  return db.prepare('SELECT * FROM frames WHERE slug = ?').get(slug);
}

function getFrameByProject(projectId) {
  return db.prepare('SELECT * FROM frames WHERE project_id = ?').get(projectId);
}

function listFrames({ unlinkedOnly = false, limit = 500 } = {}) {
  return db
    .prepare(
      `SELECT f.*, p.slug AS project_slug, p.recipient_name FROM frames f
       LEFT JOIN projects p ON p.id = f.project_id
       ${unlinkedOnly ? 'WHERE f.project_id IS NULL' : ''}
       ORDER BY f.id DESC LIMIT ?`
    )
    .all(limit);
}

// Associe un cadre à un projet ; crée le cadre si le slug n'existe pas encore.
function linkFrame(slug, projectId) {
  const tx = db.transaction(() => {
    db.prepare('UPDATE frames SET project_id = NULL, linked_at = NULL WHERE project_id = ?').run(projectId);
    let f = getFrameBySlug(slug);
    if (!f) {
      db.prepare('INSERT INTO frames (slug) VALUES (?)').run(slug);
      f = getFrameBySlug(slug);
    } else if (f.project_id && f.project_id !== projectId) {
      throw new Error('frame_already_linked');
    }
    db.prepare("UPDATE frames SET project_id = ?, linked_at = datetime('now') WHERE id = ?").run(projectId, f.id);
    return getFrameBySlug(slug);
  });
  return tx();
}

function unlinkFrame(projectId) {
  db.prepare('UPDATE frames SET project_id = NULL, linked_at = NULL WHERE project_id = ?').run(projectId);
}

// Suppression complète d'un projet (contenus compris). Les fichiers restent sur le disque.
function deleteProject(projectId) {
  const tx = db.transaction(() => {
    unlinkFrame(projectId);
    db.prepare('DELETE FROM memories WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM photos WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM contributions WHERE project_id = ?').run(projectId);
    db.prepare('UPDATE email_log SET project_id = NULL WHERE project_id = ?').run(projectId);
    return db.prepare('DELETE FROM projects WHERE id = ?').run(projectId).changes;
  });
  return tx();
}

// ---------------------------------------------------------------------------
// Projets
// ---------------------------------------------------------------------------
function createProject({ organizerEmail, organizerName, formulaId, capacity, shopify = {}, recipientName, occasion, eventDate, projectName }) {
  const token = newToken();
  const tx = db.transaction(() => {
    for (;;) {
      const slug = randomSlug(8);
      try {
        const r = db
          .prepare(
            `INSERT INTO projects (slug, organizer_token_hash, organizer_token_enc, organizer_email, organizer_name, formula_id, capacity,
             recipient_name, occasion, event_date, project_name, shopify_order_id, shopify_order_number, shopify_customer_email)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            slug,
            hashToken(token),
            encryptToken(token),
            String(organizerEmail || '').trim().toLowerCase(),
            organizerName || null,
            formulaId || null,
            capacity,
            recipientName || null,
            occasion || null,
            eventDate || null,
            projectName || null,
            shopify.orderId ? String(shopify.orderId) : null,
            shopify.orderNumber ? String(shopify.orderNumber) : null,
            shopify.customerEmail || null
          );
        return r.lastInsertRowid;
      } catch (err) {
        if (!String(err.message).includes('UNIQUE')) throw err;
      }
    }
  });
  const id = tx();
  return { project: getProject(id), token };
}

function getProject(id) {
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
}

function getProjectBySlug(slug) {
  return db.prepare('SELECT * FROM projects WHERE slug = ?').get(slug);
}

function getProjectByOrganizerToken(token) {
  if (typeof token !== 'string' || token.length < 16) return null;
  return db.prepare('SELECT * FROM projects WHERE organizer_token_hash = ?').get(hashToken(token));
}

function getProjectsByEmail(email) {
  return db
    .prepare('SELECT * FROM projects WHERE organizer_email = ? OR shopify_customer_email = ? ORDER BY id DESC')
    .all(String(email).trim().toLowerCase(), String(email).trim().toLowerCase());
}

function getProjectByOrder(orderId) {
  return db.prepare('SELECT * FROM projects WHERE shopify_order_id = ?').all(String(orderId));
}

// Nouveau lien organisateur : l'ancien cesse immédiatement de fonctionner
function rotateOrganizerToken(projectId) {
  const token = newToken();
  db.prepare("UPDATE projects SET organizer_token_hash = ?, organizer_token_enc = ?, updated_at = datetime('now') WHERE id = ?").run(
    hashToken(token), encryptToken(token), projectId
  );
  return token;
}

const SETUP_FIELDS = ['recipient_name', 'project_name', 'occasion', 'event_date', 'organizer_name', 'recipient_gender', 'deadline'];
const GENDERS = ['f', 'm', 'autre'];

function setupProject(id, data) {
  const p = getProject(id);
  if (!p) return null;
  const vals = {};
  for (const f of SETUP_FIELDS) {
    if (data[f] === undefined) continue;
    let v = data[f] == null ? null : String(data[f]).trim().slice(0, 120);
    if ((f === 'event_date' || f === 'deadline') && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error('invalid_date');
    if (f === 'recipient_gender' && v && !GENDERS.includes(v)) throw new Error('invalid_gender');
    vals[f] = v || null;
  }
  const sets = Object.keys(vals).map((k) => `${k} = @${k}`);
  if (!sets.length) return p;
  const status = p.status === 'preparing' && (vals.recipient_name || p.recipient_name) ? 'collecting' : p.status;
  db.prepare(
    `UPDATE projects SET ${sets.join(', ')}, status = @status, setup_at = COALESCE(setup_at, datetime('now')),
     updated_at = datetime('now') WHERE id = @id`
  ).run({ ...vals, status, id });
  return getProject(id);
}

function updateProjectAdmin(id, data) {
  const p = getProject(id);
  if (!p) return null;
  const allowed = [...SETUP_FIELDS, 'organizer_email', 'capacity', 'admin_notes', 'frame_text', 'template_id'];
  if (data.recipient_gender && !GENDERS.includes(data.recipient_gender)) delete data.recipient_gender;
  const vals = {};
  for (const f of allowed) {
    if (data[f] === undefined) continue;
    vals[f] = data[f] == null || data[f] === '' ? null : data[f];
  }
  if (vals.capacity != null) vals.capacity = Math.max(1, Math.min(1000, Number(vals.capacity) || p.capacity));
  if (vals.organizer_email) vals.organizer_email = String(vals.organizer_email).trim().toLowerCase();
  const sets = Object.keys(vals).map((k) => `${k} = @${k}`);
  if (!sets.length) return p;
  db.prepare(`UPDATE projects SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = @id`).run({ ...vals, id });
  return getProject(id);
}

function setProjectStatus(id, status) {
  if (!STATUSES.includes(status)) throw new Error('invalid_status');
  const extra =
    status === 'sealed' ? ", sealed_at = COALESCE(sealed_at, datetime('now'))" :
    status === 'shipped' ? ", shipped_at = COALESCE(shipped_at, datetime('now'))" : '';
  db.prepare(`UPDATE projects SET status = ?${extra}, updated_at = datetime('now') WHERE id = ?`).run(status, id);
  return getProject(id);
}

function addCapacity(id, seats) {
  db.prepare("UPDATE projects SET capacity = capacity + ?, capacity_alert_sent_at = NULL, updated_at = datetime('now') WHERE id = ?").run(seats, id);
  return getProject(id);
}

function markCapacityAlert(id) {
  db.prepare("UPDATE projects SET capacity_alert_sent_at = datetime('now') WHERE id = ?").run(id);
}

function markReminder(id) {
  db.prepare("UPDATE projects SET reminder_sent_at = datetime('now') WHERE id = ?").run(id);
}

function markRevealSeen(id) {
  db.prepare("UPDATE projects SET reveal_seen_at = datetime('now') WHERE id = ? AND reveal_seen_at IS NULL").run(id);
}

function resetReveal(id) {
  db.prepare("UPDATE projects SET reveal_seen_at = NULL, updated_at = datetime('now') WHERE id = ?").run(id);
}

function listProjects({ status, q, limit = 200 } = {}) {
  const where = [];
  const params = {};
  if (status && STATUSES.includes(status)) { where.push('p.status = @status'); params.status = status; }
  if (q) {
    where.push('(p.recipient_name LIKE @q OR p.organizer_email LIKE @q OR p.organizer_name LIKE @q OR p.slug LIKE @q OR p.shopify_order_number LIKE @q OR p.project_name LIKE @q)');
    params.q = `%${q}%`;
  }
  params.limit = limit;
  return db
    .prepare(
      `SELECT p.*, f.name AS formula_name, t.name AS template_name, t.slot_count, fr.slug AS frame_slug,
         (SELECT COUNT(*) FROM contributions c WHERE c.project_id = p.id AND c.status = 'done' AND c.deleted_at IS NULL) AS contributions_count,
         (SELECT COUNT(*) FROM photos ph WHERE ph.project_id = p.id AND ph.deleted_at IS NULL) AS photos_count
       FROM projects p
       LEFT JOIN formulas f ON f.id = p.formula_id
       LEFT JOIN templates t ON t.id = p.template_id
       LEFT JOIN frames fr ON fr.project_id = p.id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY p.id DESC LIMIT @limit`
    )
    .all(params);
}

function projectStats() {
  const rows = db.prepare('SELECT status, COUNT(*) AS n FROM projects GROUP BY status').all();
  const out = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const r of rows) out[r.status] = r.n;
  out.total = rows.reduce((a, r) => a + r.n, 0);
  return out;
}

// Projets dont la date d'événement approche et sans rappel envoyé
function projectsNeedingReminder(daysBefore) {
  return db
    .prepare(
      `SELECT * FROM projects WHERE status = 'collecting' AND reminder_sent_at IS NULL
       AND COALESCE(deadline, event_date) IS NOT NULL
       AND date(COALESCE(deadline, event_date)) <= date('now', '+' || ? || ' days')
       AND date(COALESCE(deadline, event_date)) >= date('now')`
    )
    .all(daysBefore);
}

// ---------------------------------------------------------------------------
// Contributions
// ---------------------------------------------------------------------------
// Places occupées : contributions validées + brouillons récents (moins d'une heure)
function usedSeats(projectId) {
  return db
    .prepare(
      `SELECT COUNT(*) AS n FROM contributions WHERE project_id = ? AND deleted_at IS NULL
       AND (status = 'done' OR created_at > datetime('now', '-1 hour'))`
    )
    .get(projectId).n;
}

function countDone(projectId) {
  return db
    .prepare("SELECT COUNT(*) AS n FROM contributions WHERE project_id = ? AND status = 'done' AND deleted_at IS NULL")
    .get(projectId).n;
}

const RELATIONS = ['ami', 'famille', 'amour', 'collegue', 'autre'];

function createContribution(projectId, { name, relation }) {
  const token = newToken();
  const r = db
    .prepare('INSERT INTO contributions (project_id, token_hash, contributor_name, relation) VALUES (?, ?, ?, ?)')
    .run(projectId, hashToken(token), name, relation && RELATIONS.includes(relation) ? relation : null);
  return { contribution: getContribution(r.lastInsertRowid), token };
}

function updateContribution(id, { name, relation }) {
  const c = getContribution(id);
  if (!c) return null;
  db.prepare('UPDATE contributions SET contributor_name = ?, relation = ? WHERE id = ?').run(
    name != null ? String(name).trim().slice(0, 40) || c.contributor_name : c.contributor_name,
    relation !== undefined ? (relation && RELATIONS.includes(relation) ? relation : null) : c.relation,
    id
  );
  return getContribution(id);
}

function setStarMemory(contributionId, memoryId) {
  db.prepare('UPDATE contributions SET star_memory_id = ? WHERE id = ?').run(memoryId || null, contributionId);
}

// ---------------------------------------------------------------------------
// Souvenirs (mot libre et réponses aux questions)
// ---------------------------------------------------------------------------
function addMemory(projectId, contributionId, { kind, isFree = false, questionText = null, questionCategory = null, questionId = null, text = null, audio = null, photoId = null }) {
  if (!['voice', 'text', 'photo'].includes(kind)) throw new Error('invalid_kind');
  const sort = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS s FROM memories WHERE contribution_id = ?').get(contributionId).s;
  const r = db
    .prepare(
      `INSERT INTO memories (project_id, contribution_id, kind, is_free, question_text, question_category, question_id, text_body,
         audio_file, audio_mime, audio_duration_s, photo_id, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(projectId, contributionId, kind, isFree ? 1 : 0, questionText, questionCategory, questionId, text,
      audio ? audio.file : null, audio ? audio.mime : null, audio ? audio.duration_s : null, photoId, sort);
  return getMemory(r.lastInsertRowid);
}

function getMemory(id) {
  return db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
}

function updateMemoryText(id, text) {
  db.prepare("UPDATE memories SET text_body = ?, kind = 'text', audio_file = NULL, audio_mime = NULL, audio_duration_s = NULL WHERE id = ?").run(text, id);
  return getMemory(id);
}

// Suppression définitive (parcours contributeur) : retourne les fichiers à effacer
function deleteMemory(id) {
  const m = getMemory(id);
  if (!m) return null;
  const photo = m.photo_id ? getPhoto(m.photo_id) : null;
  db.prepare('DELETE FROM memories WHERE id = ?').run(id);
  if (photo) db.prepare('DELETE FROM photos WHERE id = ?').run(photo.id);
  db.prepare('UPDATE contributions SET star_memory_id = NULL WHERE star_memory_id = ?').run(id);
  return { memory: m, photo };
}

// Modération admin : masque / restaure
function setMemoryDeleted(id, deleted) {
  db.prepare("UPDATE memories SET deleted_at = " + (deleted ? "datetime('now')" : 'NULL') + ' WHERE id = ?').run(id);
}

function listMemories(contributionId, { includeDeleted = false } = {}) {
  return db
    .prepare(
      `SELECT m.*, ph.file_square AS photo_square, ph.file_thumb AS photo_thumb FROM memories m
       LEFT JOIN photos ph ON ph.id = m.photo_id
       WHERE m.contribution_id = ? ${includeDeleted ? '' : 'AND m.deleted_at IS NULL'}
       ORDER BY m.sort_order, m.id`
    )
    .all(contributionId);
}

function countMemories(contributionId) {
  return db.prepare('SELECT COUNT(*) AS n FROM memories WHERE contribution_id = ? AND deleted_at IS NULL').get(contributionId).n;
}

// Tous les souvenirs visibles d'un projet (contributions validées, non masquées),
// avec les informations du proche : base du reveal et de la bibliothèque.
function listProjectMemories(projectId) {
  return db
    .prepare(
      `SELECT m.*, c.contributor_name, c.relation, c.star_memory_id, c.completed_at,
         ph.file_square AS photo_square, ph.file_thumb AS photo_thumb,
         (SELECT file_thumb FROM photos s WHERE s.contribution_id = c.id AND s.role = 'selfie' AND s.deleted_at IS NULL LIMIT 1) AS selfie_thumb,
         (SELECT file_square FROM photos mp WHERE mp.contribution_id = c.id AND mp.role = 'main' AND mp.deleted_at IS NULL LIMIT 1) AS main_square
       FROM memories m
       JOIN contributions c ON c.id = m.contribution_id
       LEFT JOIN photos ph ON ph.id = m.photo_id
       WHERE m.project_id = ? AND m.deleted_at IS NULL AND c.status = 'done' AND c.deleted_at IS NULL
       ORDER BY c.completed_at, c.id, (m.id = c.star_memory_id) DESC, m.sort_order, m.id`
    )
    .all(projectId);
}

function getContribution(id) {
  return db.prepare('SELECT * FROM contributions WHERE id = ?').get(id);
}

function getContributionByToken(projectId, id, token) {
  if (typeof token !== 'string' || token.length < 16) return null;
  return db
    .prepare('SELECT * FROM contributions WHERE id = ? AND project_id = ? AND token_hash = ?')
    .get(id, projectId, hashToken(token));
}

function setContributionQuestion(id, questionId, questionText) {
  db.prepare('UPDATE contributions SET question_id = ?, question_text = ? WHERE id = ?').run(questionId || null, questionText || null, id);
}

function setContributionVoice(id, { file, mime, duration_s }) {
  db.prepare(
    `UPDATE contributions SET kind = 'voice', audio_file = ?, audio_mime = ?, audio_duration_s = ?, text_body = NULL WHERE id = ?`
  ).run(file, mime, duration_s, id);
}

function setContributionText(id, text) {
  db.prepare(
    `UPDATE contributions SET kind = 'text', text_body = ?, audio_file = NULL, audio_mime = NULL, audio_duration_s = NULL WHERE id = ?`
  ).run(text, id);
}

function completeContribution(id) {
  if (countMemories(id) === 0) return false;
  const c = getContribution(id);
  if (c && !c.star_memory_id) {
    const first = listMemories(id)[0];
    if (first) setStarMemory(id, first.id);
  }
  const r = db
    .prepare("UPDATE contributions SET status = 'done', completed_at = datetime('now') WHERE id = ? AND status = 'draft'")
    .run(id);
  return r.changes === 1;
}

function listContributions(projectId, { includeDeleted = false, doneOnly = true } = {}) {
  const where = ['c.project_id = ?'];
  if (!includeDeleted) where.push('c.deleted_at IS NULL');
  if (doneOnly) where.push("c.status = 'done'");
  return db
    .prepare(
      `SELECT c.*, ph.id AS photo_id, ph.file_square, ph.file_thumb,
         s.file_thumb AS selfie_thumb,
         (SELECT COUNT(*) FROM memories m WHERE m.contribution_id = c.id AND m.deleted_at IS NULL) AS memories_count,
         (SELECT GROUP_CONCAT(DISTINCT m.kind) FROM memories m WHERE m.contribution_id = c.id AND m.deleted_at IS NULL) AS kinds
       FROM contributions c
       LEFT JOIN photos ph ON ph.contribution_id = c.id AND ph.role = 'main' AND ph.deleted_at IS NULL
       LEFT JOIN photos s ON s.contribution_id = c.id AND s.role = 'selfie' AND s.deleted_at IS NULL
       WHERE ${where.join(' AND ')}
       ORDER BY c.completed_at, c.id`
    )
    .all(projectId);
}

function softDeleteContribution(id, projectId) {
  db.prepare("UPDATE contributions SET deleted_at = datetime('now') WHERE id = ? AND project_id = ?").run(id, projectId);
  db.prepare("UPDATE photos SET deleted_at = datetime('now'), slot = NULL WHERE contribution_id = ? AND project_id = ?").run(id, projectId);
}

function restoreContribution(id, projectId) {
  db.prepare('UPDATE contributions SET deleted_at = NULL WHERE id = ? AND project_id = ?').run(id, projectId);
  db.prepare('UPDATE photos SET deleted_at = NULL WHERE contribution_id = ? AND project_id = ?').run(id, projectId);
}

// Brouillons abandonnés (contributeur parti en cours de route) : retourne les
// lignes à purger (fichiers inclus) puis les supprime.
function purgeDrafts(hours = 24) {
  const drafts = db
    .prepare("SELECT id FROM contributions WHERE status = 'draft' AND created_at < datetime('now', '-' || ? || ' hours')")
    .all(hours)
    .map((r) => r.id);
  const rows = [];
  const del = db.transaction(() => {
    for (const id of drafts) {
      for (const ph of db.prepare('SELECT * FROM photos WHERE contribution_id = ?').all(id)) rows.push(ph);
      for (const m of db.prepare('SELECT * FROM memories WHERE contribution_id = ?').all(id)) rows.push(m);
      db.prepare('DELETE FROM memories WHERE contribution_id = ?').run(id);
      db.prepare('DELETE FROM photos WHERE contribution_id = ?').run(id);
      db.prepare('DELETE FROM contributions WHERE id = ?').run(id);
    }
  });
  del();
  return rows; // photos ({file_original…}) et souvenirs ({audio_file}) dont les fichiers sont à effacer
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------
function addPhoto(projectId, { contributionId = null, source = 'contributor', role = 'main', file_original, file_square, file_thumb, width, height, crop }) {
  const sort = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS s FROM photos WHERE project_id = ?').get(projectId).s;
  const r = db
    .prepare(
      `INSERT INTO photos (project_id, contribution_id, source, role, file_original, file_square, file_thumb, width, height, crop, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(projectId, contributionId, source, role, file_original, file_square, file_thumb, width || null, height || null, crop ? JSON.stringify(crop) : null, sort);
  return getPhoto(r.lastInsertRowid);
}

function getContributionPhoto(contributionId, role) {
  return db.prepare('SELECT * FROM photos WHERE contribution_id = ? AND role = ? AND deleted_at IS NULL ORDER BY id DESC').get(contributionId, role);
}

function getPhoto(id) {
  return db.prepare('SELECT * FROM photos WHERE id = ?').get(id);
}

function getProjectPhoto(projectId, id) {
  return db.prepare('SELECT * FROM photos WHERE id = ? AND project_id = ?').get(id, projectId);
}

// Une contribution n'a qu'une photo par rôle (cadre, selfie) : l'ancienne est
// retournée pour suppression de ses fichiers.
function replaceContributionPhoto(contributionId, role = 'main') {
  const old = db.prepare('SELECT * FROM photos WHERE contribution_id = ? AND role = ?').all(contributionId, role);
  db.prepare('DELETE FROM photos WHERE contribution_id = ? AND role = ?').run(contributionId, role);
  return old;
}

function listPhotos(projectId, { includeDeleted = false, doneOnly = true, role = 'main' } = {}) {
  const where = ['ph.project_id = ?'];
  if (!includeDeleted) where.push('ph.deleted_at IS NULL');
  if (doneOnly) where.push("(ph.contribution_id IS NULL OR c.status = 'done')");
  if (role) where.push(`ph.role = '${role === 'all' ? '' : role}'`.replace("ph.role = ''", '1 = 1'));
  return db
    .prepare(
      `SELECT ph.*, c.contributor_name FROM photos ph
       LEFT JOIN contributions c ON c.id = ph.contribution_id
       WHERE ${where.join(' AND ')}
       ORDER BY ph.slot IS NULL, ph.slot, ph.sort_order, ph.id`
    )
    .all(projectId);
}

function softDeletePhoto(id, projectId) {
  db.prepare("UPDATE photos SET deleted_at = datetime('now'), slot = NULL WHERE id = ? AND project_id = ?").run(id, projectId);
}

function hardDeletePhoto(id, projectId) {
  const ph = getProjectPhoto(projectId, id);
  if (ph) db.prepare('DELETE FROM photos WHERE id = ?').run(id);
  return ph;
}

// Composition : affecte chaque emplacement à une photo (ou vide). `assignments`
// = [{ photoId, slot }] ; toute photo non listée perd son emplacement.
function setComposition(projectId, templateId, assignments, frameText) {
  const tx = db.transaction(() => {
    db.prepare('UPDATE photos SET slot = NULL WHERE project_id = ?').run(projectId);
    const upd = db.prepare('UPDATE photos SET slot = ? WHERE id = ? AND project_id = ? AND deleted_at IS NULL');
    for (const a of assignments) upd.run(a.slot, a.photoId, projectId);
    db.prepare("UPDATE projects SET template_id = ?, frame_text = ?, updated_at = datetime('now') WHERE id = ?").run(
      templateId || null,
      frameText != null ? String(frameText).slice(0, 200) : null,
      projectId
    );
  });
  tx();
}

function sealProject(projectId) {
  const r = db
    .prepare("UPDATE projects SET status = 'sealed', sealed_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND status = 'collecting'")
    .run(projectId);
  return r.changes === 1;
}

// ---------------------------------------------------------------------------
// Journal des emails / événements Shopify
// ---------------------------------------------------------------------------
function logEmail({ projectId, type, to, subject, status, error }) {
  db.prepare('INSERT INTO email_log (project_id, type, to_email, subject, status, error) VALUES (?, ?, ?, ?, ?, ?)').run(
    projectId || null, type, to, subject, status, error || null
  );
}

function listEmails(projectId, limit = 50) {
  return db.prepare('SELECT * FROM email_log WHERE project_id = ? ORDER BY id DESC LIMIT ?').all(projectId, limit);
}

function recordShopifyEvent(id, topic, orderId) {
  try {
    db.prepare('INSERT INTO shopify_events (id, topic, order_id) VALUES (?, ?, ?)').run(id, topic, orderId || null);
    return true;
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return false; // déjà traité
    throw err;
  }
}

function setShopifyEventResult(id, result) {
  db.prepare('UPDATE shopify_events SET result = ? WHERE id = ?').run(result, id);
}

module.exports = {
  now,
  deleteProject,
  hashToken,
  getOrganizerToken,
  getSetting, setSetting, allSettings,
  listFormulas, getFormula, findFormulaForLineItem, saveFormula, deleteFormula,
  listTemplates, getTemplate, getTemplateByKey, upsertTemplate, updateTemplate, deleteTemplate,
  listQuestions, saveQuestion, deleteQuestion, pickQuestion, fillQuestion, genderize, questionCategories,
  createFrames, getFrameBySlug, getFrameByProject, listFrames, linkFrame, unlinkFrame,
  createProject, getProject, getProjectBySlug, getProjectByOrganizerToken, getProjectsByEmail, getProjectByOrder,
  rotateOrganizerToken, setupProject, updateProjectAdmin, setProjectStatus, addCapacity, markCapacityAlert,
  markReminder, markRevealSeen, resetReveal, listProjects, projectStats, projectsNeedingReminder,
  usedSeats, countDone, createContribution, updateContribution, setStarMemory, getContribution, getContributionByToken, setContributionQuestion,
  addMemory, getMemory, updateMemoryText, deleteMemory, setMemoryDeleted, listMemories, countMemories, listProjectMemories,
  setContributionVoice, setContributionText, completeContribution, listContributions, softDeleteContribution,
  restoreContribution, purgeDrafts,
  addPhoto, getPhoto, getProjectPhoto, getContributionPhoto, replaceContributionPhoto, listPhotos, softDeletePhoto, hardDeletePhoto,
  RELATIONS,
  setComposition, sealProject,
  logEmail, listEmails, recordShopifyEvent, setShopifyEventResult,
  STATUSES,
};
