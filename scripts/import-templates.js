'use strict';

/*
 * Import des gabarits de cadre (SVG) dans l'application.
 *
 *   node scripts/import-templates.js <dossier ou fichiers .svg>
 *
 * Chaque SVG est nettoyé, analysé (emplacements photo, zone texte), copié dans
 * data/templates/ et enregistré en base. Un gabarit déjà importé (même nom de
 * fichier) est mis à jour. L'administration permet la même opération depuis le
 * navigateur ; ce script sert au premier chargement et aux lots.
 */

const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const store = require('../src/store');
const { parseTemplate, sanitizeSvg } = require('../src/templates');

const args = process.argv.slice(2);
if (!args.length) {
  console.error('Usage : node scripts/import-templates.js <dossier ou fichiers .svg>');
  process.exit(1);
}

const files = [];
for (const a of args) {
  const st = fs.statSync(a);
  if (st.isDirectory()) {
    for (const f of fs.readdirSync(a)) if (f.toLowerCase().endsWith('.svg') && !f.startsWith('.')) files.push(path.join(a, f));
  } else files.push(a);
}

function prettyName(key) {
  const m = key.match(/^ravive_(coeur_)?(\d+)_photos(_texte)?/i);
  if (!m) return key.replace(/[_-]+/g, ' ');
  return `${m[1] ? 'Cœur ' : 'Mosaïque '}${m[2]} photos${m[3] ? ' + petit mot' : ''}`;
}

let ok = 0;
for (const file of files.sort()) {
  const key = path.basename(file, path.extname(file)).toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
  try {
    const svg = sanitizeSvg(fs.readFileSync(file, 'utf8'));
    const parsed = parseTemplate(svg);
    const target = `${key}.svg`;
    fs.writeFileSync(path.join(config.TEMPLATES_DIR, target), svg);
    const t = store.upsertTemplate({ key, name: prettyName(key), file: target, parsed });
    ok++;
    console.log(`✔ ${t.name} (${key}) : ${parsed.slotCount} emplacements${parsed.hasText ? ', zone texte' : ''}`);
    for (const w of parsed.warnings.slice(0, 3)) console.log(`    ⚠ ${w}`);
    if (parsed.warnings.length > 3) console.log(`    … ${parsed.warnings.length - 3} autre(s) avertissement(s)`);
  } catch (err) {
    console.error(`✘ ${file} : ${err.message}`);
  }
}
console.log(`${ok}/${files.length} gabarit(s) importé(s).`);
