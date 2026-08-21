'use strict';

const crypto = require('crypto');
const config = require('./config');

// Jeton d'activation signé (HMAC) : autorise l'upload du vocal après
// validation du code, sans session serveur.

function sign(payload) {
  return crypto.createHmac('sha256', config.SECRET).update(payload).digest('base64url');
}

function issueToken(slug) {
  const exp = Math.floor(Date.now() / 1000) + config.TOKEN_TTL_S;
  const payload = `${slug}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token, slug) {
  if (typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [tokenSlug, expStr, sig] = parts;
  if (tokenSlug !== slug) return false;
  if (Number(expStr) < Math.floor(Date.now() / 1000)) return false;
  const expected = sign(`${tokenSlug}.${expStr}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { issueToken, verifyToken };
