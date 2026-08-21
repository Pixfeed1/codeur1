'use strict';

/*
 * Génération d'un lot de cartes NFC.
 *
 *   node scripts/generate-cards.js 50
 *
 * Pour chaque carte : un slug unique (l'URL à encoder dans la puce NFC)
 * et un code d'activation (à imprimer dans le packaging, jamais stocké en
 * clair — seul son empreinte est en base).
 *
 * Sortie : CSV affiché à l'écran ET sauvegardé dans data/exports/,
 * à transmettre à l'encodeur NFC / l'imprimeur.
 */

const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const db = require('../src/db');

const count = Number(process.argv[2]);
if (!Number.isInteger(count) || count < 1 || count > 10000) {
  console.error('Usage : node scripts/generate-cards.js <nombre de cartes (1-10000)>');
  process.exit(1);
}

const rows = [['url_nfc', 'code_activation']];
for (let i = 0; i < count; i++) {
  const { slug, code } = db.createCard();
  // Code présenté par groupes de 3 pour la lisibilité sur le packaging
  const pretty = `${code.slice(0, 3)}-${code.slice(3)}`;
  rows.push([`${config.BASE_URL}/c/${slug}`, pretty]);
}

const csv = rows.map((r) => r.join(';')).join('\n') + '\n';
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const file = path.join(config.EXPORTS_DIR, `cartes-${stamp}.csv`);
fs.writeFileSync(file, csv);

process.stdout.write(csv);
console.error(`\n${count} carte(s) générée(s) — export : ${file}`);
console.error('⚠ Ce fichier contient les codes en clair : à transmettre de façon sécurisée puis à supprimer.');
