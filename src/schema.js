'use strict';

/*
 * Schéma du produit « cadres souvenirs collaboratifs » (Ravive V1 cadres).
 *
 * La table `cards` (cartes NFC vocales, produit historique) est gérée dans
 * db.js et reste intacte. Tout ce qui suit s'ajoute à côté, dans la même base
 * SQLite : un seul fichier data/ravive.db à sauvegarder.
 */

const STATUSES = ['preparing', 'collecting', 'sealed', 'production', 'shipped', 'done'];

function migrate(db) {
  db.exec(`
    -- Réglages modifiables depuis l'administration (clé/valeur JSON)
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Formules commerciales : capacité en proches, correspondance Shopify
    CREATE TABLE IF NOT EXISTS formulas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      max_contributors INTEGER NOT NULL,
      price_cents INTEGER NOT NULL DEFAULT 0,
      shopify_variant_id TEXT,            -- id de variante Shopify (prioritaire)
      shopify_sku TEXT,                   -- ou SKU de la variante
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Gabarits de cadre (SVG fournis par Ravive, emplacements extraits)
    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,           -- ex. ravive_20_photos_texte
      name TEXT NOT NULL,
      file TEXT NOT NULL,                 -- fichier SVG dans data/templates/
      slot_count INTEGER NOT NULL,
      has_text INTEGER NOT NULL DEFAULT 0,
      slots TEXT NOT NULL,                -- JSON [{i,x,y,w,h}] en mm (viewBox 180x240)
      text_zone TEXT,                     -- JSON {x,y,w,h} ou NULL
      width_mm REAL NOT NULL DEFAULT 180,
      height_mm REAL NOT NULL DEFAULT 240,
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Bibliothèque de questions proposées aux contributeurs
    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,                 -- peut contenir {prenom} (prénom du destinataire)
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Cadres physiques : chaque puce NFC encode /f/<slug>
    CREATE TABLE IF NOT EXISTS frames (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      project_id INTEGER UNIQUE REFERENCES projects(id) ON DELETE SET NULL,
      label TEXT,                         -- repère interne (n° de lot, etc.)
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      linked_at TEXT
    );

    -- Projets (un cadre = un projet)
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,          -- code de participation : /p/<slug>
      organizer_token_hash TEXT NOT NULL, -- lien privé organisateur : /o/<token> (jamais en clair)
      organizer_email TEXT NOT NULL,
      organizer_name TEXT,
      recipient_name TEXT,
      project_name TEXT,
      occasion TEXT,
      event_date TEXT,                    -- YYYY-MM-DD
      formula_id INTEGER REFERENCES formulas(id),
      capacity INTEGER NOT NULL,          -- nombre max de proches (extensible)
      status TEXT NOT NULL DEFAULT 'preparing',
      template_id INTEGER REFERENCES templates(id),
      frame_text TEXT,                    -- petit mot (gabarits avec zone texte)
      shopify_order_id TEXT,
      shopify_order_number TEXT,
      shopify_customer_email TEXT,
      reveal_seen_at TEXT,                -- premier reveal terminé par le destinataire
      capacity_alert_sent_at TEXT,
      reminder_sent_at TEXT,
      admin_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      setup_at TEXT,                      -- formulaire de création rempli
      sealed_at TEXT,
      shipped_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
    CREATE INDEX IF NOT EXISTS idx_projects_order ON projects(shopify_order_id);

    -- Contributions (un proche = une contribution : photo + vocal ou texte)
    CREATE TABLE IF NOT EXISTS contributions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,           -- jeton d'édition le temps du parcours
      contributor_name TEXT NOT NULL,
      question_id INTEGER,
      question_text TEXT,
      kind TEXT,                          -- 'voice' | 'text' (NULL tant que rien n'est déposé)
      text_body TEXT,
      audio_file TEXT,
      audio_mime TEXT,
      audio_duration_s REAL,
      status TEXT NOT NULL DEFAULT 'draft',   -- draft | done
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      deleted_at TEXT                     -- modération : masqué, fichiers conservés jusqu'à purge
    );
    CREATE INDEX IF NOT EXISTS idx_contrib_project ON contributions(project_id, status);

    -- Photos : déposées par un proche (contribution_id) ou par l'organisateur / l'admin
    CREATE TABLE IF NOT EXISTS photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      contribution_id INTEGER REFERENCES contributions(id) ON DELETE SET NULL,
      source TEXT NOT NULL DEFAULT 'contributor',  -- contributor | organizer | admin
      file_original TEXT NOT NULL,        -- original compressé (max 2400 px)
      file_square TEXT NOT NULL,          -- recadrage carré (1200 px) pour cadre et écrans
      file_thumb TEXT NOT NULL,           -- vignette carrée (400 px)
      mime TEXT NOT NULL DEFAULT 'image/jpeg',
      width INTEGER,
      height INTEGER,
      crop TEXT,                          -- JSON {x,y,w,h} en px de l'original
      slot INTEGER,                       -- emplacement dans le gabarit (composition)
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_photos_project ON photos(project_id);

    -- Souvenirs : plusieurs par contribution (mot libre + réponses aux questions),
    -- chacun en vocal, texte ou photo. Le souvenir « étoilé » est celui que le
    -- destinataire découvre au reveal ; les autres restent dans la bibliothèque.
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      contribution_id INTEGER NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,                 -- voice | text | photo
      is_free INTEGER NOT NULL DEFAULT 0, -- 1 = mot libre (sans question)
      question_text TEXT,
      question_category TEXT,
      question_id INTEGER,
      text_body TEXT,
      audio_file TEXT,
      audio_mime TEXT,
      audio_duration_s REAL,
      photo_id INTEGER REFERENCES photos(id) ON DELETE SET NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_memories_contrib ON memories(contribution_id);

    -- Journal des emails envoyés (traçabilité, relances non dupliquées)
    CREATE TABLE IF NOT EXISTS email_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      type TEXT NOT NULL,
      to_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      status TEXT NOT NULL,               -- sent | failed | skipped
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Webhooks Shopify reçus (idempotence)
    CREATE TABLE IF NOT EXISTS shopify_events (
      id TEXT PRIMARY KEY,                -- X-Shopify-Webhook-Id
      topic TEXT NOT NULL,
      order_id TEXT,
      received_at TEXT NOT NULL DEFAULT (datetime('now')),
      result TEXT
    );
  `);

  // Migrations douces (colonnes ajoutées après coup)
  for (const [table, col] of [
    ['projects', 'organizer_token_enc TEXT'],
    ['projects', 'recipient_gender TEXT'],       // f | m | autre
    ['projects', 'deadline TEXT'],               // fin de collecte (YYYY-MM-DD), informative
    ['contributions', 'relation TEXT'],          // ami | famille | amour | collegue | autre
    ['contributions', 'star_memory_id INTEGER'], // souvenir montré au reveal
    ['photos', "role TEXT NOT NULL DEFAULT 'main'"], // main (cadre) | selfie | memory
    ['questions', 'category TEXT'],
  ]) {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col}`);
    } catch (err) {
      if (!String(err.message).includes('duplicate column')) throw err;
    }
  }

  // Valeurs par défaut des réglages (ne remplace jamais une valeur existante)
  const defaults = {
    max_audio_s: 60,
    max_text_chars: 1000,
    capacity_alert_pct: 80,
    extra_seat_price_cents: 200,
    extra_seat_shopify_variant_id: '',
    extra_seat_shopify_sku: 'RAVIVE-EXTRA',
    reminder_days_before: 3,
    fabrication_days: 7,       // livraison estimée = fin de collecte + N jours
    max_memories_per_contributor: 4,
    relations: [['ami', 'Ami·e'], ['famille', 'De la famille'], ['amour', 'En couple'], ['collegue', 'Collègue'], ['autre', 'Autre']],
    question_categories: [
      ['dire', '❤️', 'Lui dire quelque chose', 'Qu’est-ce que tu aimerais vraiment lui dire ?'],
      ['souv', '🥹', 'Se souvenir', 'Quel souvenir te revient ?'],
      ['dossier', '😂', 'Sortir un dossier', 'Allez, sors-nous un dossier 👀'],
      ['nous', '🫶', 'Parler de vous', 'Qu’est-ce qui raconte le mieux votre relation ?'],
      ['devant', '✨', 'Regarder devant', 'Et pour la suite ?'],
    ],
    brand_name: 'Ravive',
    contact_email: '',
    shop_url: '',
    visuals: {},
  };
  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(defaults)) insert.run(k, JSON.stringify(v));

  // Formules de lancement (cahier des charges) si la table est vide
  const count = db.prepare('SELECT COUNT(*) AS n FROM formulas').get().n;
  if (count === 0) {
    const ins = db.prepare(
      'INSERT INTO formulas (name, max_contributors, price_cents, shopify_sku, sort_order) VALUES (?, ?, ?, ?, ?)'
    );
    ins.run("Jusqu'à 10 proches", 10, 3990, 'RAVIVE-10', 1);
    ins.run("Jusqu'à 25 proches", 25, 4990, 'RAVIVE-25', 2);
    ins.run("Jusqu'à 50 proches", 50, 5990, 'RAVIVE-50', 3);
    ins.run("Jusqu'à 100 proches", 100, 6990, 'RAVIVE-100', 4);
  }

  // Questions de départ (maquette contributeur v5), modifiables dans l'administration.
  // Rédigées au féminin ; converties au masculin selon le genre du destinataire.
  const qcount = db.prepare('SELECT COUNT(*) AS n FROM questions').get().n;
  if (qcount === 0) {
    const ins = db.prepare('INSERT INTO questions (text, category, sort_order) VALUES (?, ?, ?)');
    const seed = {
      dire: [
        'Qu’est-ce que tu ne lui dis pas assez souvent ?',
        'Qu’est-ce que tu admires chez elle, sans qu’elle le sache forcément ?',
        'Si tu devais lui dire merci pour une seule chose, ce serait pour quoi ?',
        'Qu’est-ce qu’elle a apporté dans ta vie sans forcément s’en rendre compte ?',
        'Si tu pouvais lui faire comprendre une seule chose aujourd’hui, ce serait quoi ?',
      ],
      souv: [
        'Ferme les yeux : quel moment avec elle te revient immédiatement ?',
        'Quel souvenir avec elle te fait encore sourire rien qu’en y pensant ?',
        'Raconte un moment banal avec elle qui, avec le recul, est devenu précieux.',
        'Quelle photo de vous a toute une histoire derrière elle ? Raconte-la.',
        'Quel endroit, quelle chanson ou quelle odeur te fait immédiatement penser à elle ?',
      ],
      dossier: [
        'C’est quoi LE dossier sur elle que tu pourrais raconter toute ta vie ?',
        'Quel moment vous fait encore rire alors qu’il n’était pas censé être drôle ?',
        'Quelle est la chose la plus débile que vous ayez faite ensemble ?',
        'Quel est son petit défaut que tu ne voudrais surtout pas qu’elle perde ?',
        'Une histoire qui commence par « Je sais qu’on avait dit qu’on n’en parlerait plus, mais… » ?',
      ],
      nous: [
        'À quel moment tu t’es dit : « cette personne va compter dans ma vie » ?',
        'Qu’est-ce qui fait que votre relation ne ressemble à aucune autre ?',
        'Qu’est-ce que vous seuls pouvez vraiment comprendre ?',
        'Si votre relation était un seul souvenir, lequel ce serait ?',
        'Qu’est-ce qui a changé entre votre première rencontre et aujourd’hui ?',
      ],
      devant: [
        'Dans 20 ans, de quoi penses-tu que vous rigolerez encore ensemble ?',
        'Quel moment aimerais-tu absolument vivre avec elle un jour ?',
        'Si elle réécoute ce message dans 10 ans, qu’aimerais-tu lui dire ?',
        'Qu’est-ce que tu lui souhaites vraiment pour la suite, pas la réponse bateau ?',
        'Quelle promesse, même ridicule, aimerais-tu lui faire pour les années à venir ?',
      ],
    };
    let i = 0;
    for (const [cat, list] of Object.entries(seed)) for (const t of list) ins.run(t, cat, ++i);
  }
}

/**
 * Premier démarrage : importe les gabarits livrés avec l'application
 * (dossier templates/ du dépôt) si la base n'en contient aucun. Les gabarits
 * ajoutés ensuite depuis l'administration vivent dans data/templates/.
 */
function seedTemplates(db) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM templates').get().n;
  if (count > 0) return 0;
  const fs = require('fs');
  const path = require('path');
  const config = require('./config');
  const { parseTemplate, sanitizeSvg } = require('./templates');
  const src = path.join(config.ROOT, 'templates');
  if (!fs.existsSync(src)) return 0;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO templates (key, name, file, slot_count, has_text, slots, text_zone, width_mm, height_mm, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  let n = 0;
  for (const f of fs.readdirSync(src).filter((x) => x.toLowerCase().endsWith('.svg')).sort()) {
    try {
      const key = path.basename(f, '.svg').toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
      const svg = sanitizeSvg(fs.readFileSync(path.join(src, f), 'utf8'));
      const parsed = parseTemplate(svg);
      fs.writeFileSync(path.join(config.TEMPLATES_DIR, `${key}.svg`), svg);
      const m = key.match(/^ravive_(coeur_)?(\d+)_photos(_texte)?/);
      const name = m ? `${m[1] ? 'Cœur ' : 'Mosaïque '}${m[2]} photos${m[3] ? ' + petit mot' : ''}` : key;
      insert.run(key, name, `${key}.svg`, parsed.slotCount, parsed.hasText ? 1 : 0, JSON.stringify(parsed.slots),
        parsed.textZone ? JSON.stringify(parsed.textZone) : null, parsed.widthMm, parsed.heightMm, parsed.slotCount);
      n++;
    } catch (err) {
      console.error(`gabarit ${f} ignoré : ${err.message}`);
    }
  }
  if (n) console.log(`${n} gabarit(s) importé(s) depuis templates/`);
  return n;
}

module.exports = { migrate, seedTemplates, STATUSES };
