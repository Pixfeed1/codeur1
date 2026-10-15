'use strict';
// Message « tout prêt » que l'organisateur copie ou envoie sur WhatsApp pour
// inviter les proches. Le texte est personnalisable depuis l'administration
// (réglage `share_message`), avec des variables remplacées par projet.

const store = require('./store');

const DEFAULT =
  'Coucou ! On prépare une surprise pour {prenom} ❤️\n\n' +
  'Ça prend juste quelques minutes : ajoute un souvenir avec {lui} et laisse-{lui} un petit mot, drôle, touchant, ou juste comme tu le sens.\n\n' +
  'Tu peux participer ici : {lien}';

const VARIABLES = {
  prenom: 'prénom du destinataire',
  lui: '« lui » ou « elle » selon le destinataire',
  il: '« il » ou « elle »',
  le: '« le » ou « la »',
  son: '« son » ou « sa »',
  lien: 'lien de participation',
};

function pron(gender) {
  return gender === 'm' ? { lui: 'lui', il: 'il', le: 'le', son: 'son' } : { lui: 'elle', il: 'elle', le: 'la', son: 'sa' };
}

/** Texte en vigueur : personnalisé si enregistré, sinon celui d'origine. */
function template() {
  const custom = store.getSetting('share_message', null);
  return typeof custom === 'string' && custom.trim() ? custom : DEFAULT;
}

function fill(text, vars) {
  return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

/** Message prêt à envoyer pour un projet donné. */
function render(project, url, text = template()) {
  const vars = Object.assign({ prenom: project.recipient_name || 'votre proche', lien: url }, pron(project.recipient_gender));
  return fill(text, vars);
}

/** Exemple affiché dans l'administration. */
function example(text = template()) {
  return render({ recipient_name: 'Camille', recipient_gender: 'f' }, 'https://exemple.fr/p/abc123', text);
}

/** Enregistre un texte personnalisé ; `null` ou vide rétablit l'original. */
function save(text) {
  const t = typeof text === 'string' ? text.trim() : '';
  if (!t || t === DEFAULT) store.setSetting('share_message', null);
  else store.setSetting('share_message', t.slice(0, 2000));
}

function state() {
  const custom = store.getSetting('share_message', null);
  const text = template();
  return { text, default: DEFAULT, custom: typeof custom === 'string' && !!custom.trim(), variables: VARIABLES, example: example(text) };
}

module.exports = { DEFAULT, VARIABLES, template, render, example, save, state };
